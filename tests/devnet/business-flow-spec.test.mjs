import assert from "node:assert/strict";
import test from "node:test";

import { effectiveExpectedErrorNames } from "../../scripts/devnet/business-flow-errors.mjs";
import * as businessFlowSpec from "../../scripts/devnet/business-flow-spec.mjs";
import {
  BUSINESS_FLOW_EXECUTION_SPEC,
  executionSpecHash,
  selectExecutionEvents,
  validateExecutionSpec,
  validateExecutionRegistry,
} from "../../scripts/devnet/business-flow-spec.mjs";

function walk(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) walk(item, visit);
  }
}

function registryFor(spec) {
  const ids = (field) => [
    ...new Set(spec.events.map((event) => event[field]).filter(Boolean)),
  ];
  const fn = () => {};
  return {
    builders: ids("instructionBuilderId").map((id) => [id, fn]),
    verifiers: ids("postStateVerifierId").map((id) => ({ id, status: "deferred" })),
    simulations: ids("simulationDecoderId").map((id) => ({ id, status: "deferred" })),
    waits: ids("waitPolicyId").map((id) => ({ id, status: "deferred" })),
  };
}

function mutatedSpec(mutate) {
  const spec = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  mutate(spec);
  return spec;
}

function assertSpecRejected(spec, category, label) {
  assert.throws(
    () => validateExecutionSpec(spec),
    category,
    `${label}: validator`,
  );
  assert.throws(
    () => executionSpecHash(spec),
    category,
    `${label}: hash`,
  );
}

const noncanonicalArrayMutations = [
  ["enumerable named property", (array) => {
    array.extra = "x";
  }],
  ["non-enumerable named property", (array) => {
    Object.defineProperty(array, "hidden", { value: "x" });
  }],
  ["symbol property", (array) => {
    array[Symbol("extra")] = "x";
  }],
  ["custom prototype", (array) => {
    Object.setPrototypeOf(array, Object.create(Array.prototype));
  }],
  ["accessor numeric index", (array) => {
    const value = array[0];
    Object.defineProperty(array, "0", {
      configurable: true,
      enumerable: true,
      get: () => value,
    });
  }],
  ["sparse numeric index", (array) => {
    delete array[0];
  }],
  ["non-enumerable numeric index balanced by a named property", (array) => {
    const value = array[0];
    Object.defineProperty(array, "0", {
      configurable: true,
      enumerable: false,
      value,
      writable: true,
    });
    array.extra = "x";
  }],
];

const SELECTED_EVENT_IDS = Object.freeze({
  release: Object.freeze([
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "release:initialize",
    "release:fund",
    "unauthorized_release",
    "release:release",
  ]),
  refund: Object.freeze([
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "refund:initialize",
    "refund:fund",
    "refund_before_expiry",
    "refund:wait_expiry",
    "release_at_or_after_expiry",
    "refund:refund",
  ]),
  cancel: Object.freeze([
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "cancel:initialize",
    "cancel:cancel",
  ]),
});

function requestedFlowOrders(values) {
  const orders = [];
  const visit = (prefix, remaining) => {
    if (prefix.length > 0) orders.push(prefix);
    for (let index = 0; index < remaining.length; index += 1) {
      visit(
        [...prefix, remaining[index]],
        remaining.toSpliced(index, 1),
      );
    }
  };
  visit([], values);
  return orders;
}

function expectedDependencies(events, event) {
  return events
    .filter(
      (candidate) =>
        candidate.order < event.order &&
        (candidate.flow === "setup" || candidate.flow === event.flow),
    )
    .map((candidate) => candidate.id);
}

test("selected execution events are exact for release, refund, cancel, and full matrix", () => {
  for (const flow of BUSINESS_FLOW_EXECUTION_SPEC.enabledFlows) {
    const selected = selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, [flow]);
    assert.deepEqual(
      selected.events.map((event) => event.id),
      SELECTED_EVENT_IDS[flow],
      flow,
    );
  }

  const full = selectExecutionEvents(
    BUSINESS_FLOW_EXECUTION_SPEC,
    BUSINESS_FLOW_EXECUTION_SPEC.enabledFlows,
  );
  assert.deepEqual(
    full.events.map((event) => event.id),
    BUSINESS_FLOW_EXECUTION_SPEC.events.map((event) => event.id),
  );
  assert.deepEqual(
    full.sendEvents.map((event) => event.id),
    full.events.filter((event) => event.kind === "SEND").map((event) => event.id),
  );
  assert.deepEqual(
    full.simulationEvents.map((event) => event.id),
    full.events.filter((event) => event.kind === "SIMULATE").map((event) => event.id),
  );
  assert.deepEqual(
    full.waitEvents.map((event) => event.id),
    ["refund:wait_expiry"],
  );
});

test("requested-flow order permutations preserve canonical event order and complete dependencies", () => {
  for (const flows of requestedFlowOrders([
    ...BUSINESS_FLOW_EXECUTION_SPEC.enabledFlows,
  ])) {
    const selected = selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, flows);
    assert.deepEqual(selected.flows, flows);
    assert.deepEqual(
      selected.events.map((event) => event.id),
      BUSINESS_FLOW_EXECUTION_SPEC.events
        .filter(
          (event) =>
            event.flow === "setup" || flows.includes(event.flow),
        )
        .map((event) => event.id),
    );
    assert.equal(Object.getPrototypeOf(selected.dependencies), Object.prototype);
    assert.equal(Object.isFrozen(selected.dependencies), true);

    for (const event of selected.events) {
      assert.deepEqual(
        selected.dependencies[event.id],
        expectedDependencies(selected.events, event),
        `${flows.join(",")}: ${event.id}`,
      );
      assert.equal(Object.isFrozen(selected.dependencies[event.id]), true);
      assert.equal(
        selected.dependencies[event.id].some((dependencyId) => {
          const dependency = selected.events.find(
            (candidate) => candidate.id === dependencyId,
          );
          return dependency.flow !== "setup" && dependency.flow !== event.flow;
        }),
        false,
        `${event.id} must not acquire a cross-flow edge`,
      );
    }
  }
});

test("single-flow dependencies include every setup and same-flow prerequisite, including negative checks and WAIT", () => {
  for (const flow of BUSINESS_FLOW_EXECUTION_SPEC.enabledFlows) {
    const selected = selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, [flow]);
    for (const event of selected.events) {
      assert.deepEqual(
        selected.dependencies[event.id],
        expectedDependencies(selected.events, event),
        `${flow}: ${event.id}`,
      );
    }
  }

  const refund = selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, ["refund"]);
  assert.deepEqual(refund.dependencies["refund:refund"], [
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "refund:initialize",
    "refund:fund",
    "refund_before_expiry",
    "refund:wait_expiry",
    "release_at_or_after_expiry",
  ]);
});

test("selected-flow request rejects empty, duplicate, unknown, sparse, decorated, and non-array inputs", () => {
  const invalid = [
    null,
    "release",
    {},
    [],
    ["release", "release"],
    ["unknown"],
  ];
  const sparse = ["release", "refund"];
  delete sparse[0];
  invalid.push(sparse);
  for (const [, mutate] of noncanonicalArrayMutations) {
    const decorated = ["release"];
    mutate(decorated);
    invalid.push(decorated);
  }

  for (const requestedFlows of invalid) {
    assert.throws(
      () => selectExecutionEvents(BUSINESS_FLOW_EXECUTION_SPEC, requestedFlows),
      /requested execution flows are invalid/,
    );
  }
});

test("selector rejects a noncontiguous setup prefix and noncanonical event order", () => {
  const laterSetup = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  const [setup] = laterSetup.events.splice(3, 1);
  laterSetup.events.splice(5, 0, setup);
  laterSetup.events.forEach((event, order) => {
    event.order = order;
  });
  assert.throws(
    () => selectExecutionEvents(laterSetup, ["release"]),
    /contiguous setup prefix/,
  );

  const wrongOrder = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  wrongOrder.events[4].order = wrongOrder.events[3].order;
  assert.throws(
    () => selectExecutionEvents(wrongOrder, ["release"]),
    /order|malformed/,
  );
});

test("canonical array predicate accepts parsed and frozen arrays; hostile proxies are out of scope", () => {
  assert.equal(typeof businessFlowSpec.isCanonicalArray, "function");
  assert.equal(businessFlowSpec.isCanonicalArray(JSON.parse("[1,2]")), true);
  assert.equal(businessFlowSpec.isCanonicalArray(Object.freeze([1, 2])), true);

  for (const [label, mutate] of noncanonicalArrayMutations) {
    const array = [1, 2];
    mutate(array);
    assert.equal(businessFlowSpec.isCanonicalArray(array), false, label);
  }
});

test("execution spec rejects every noncanonical array boundary before hashing", () => {
  const boundaries = [
    ["instruction schemas", (spec) => spec.instructionSchemas],
    ["events", (spec) => spec.events],
    ["schema accounts", (spec) => spec.instructionSchemas[0].accounts],
    [
      "schema dynamic fields",
      (spec) => spec.instructionSchemas.find(
        (schema) => schema.dynamicFields.length > 0,
      ).dynamicFields,
    ],
    ["enabled flows", (spec) => spec.enabledFlows],
    [
      "signer roles",
      (spec) => spec.events.find(
        (event) => event.requiredNonPayerSignerRoles.length > 0,
      ).requiredNonPayerSignerRoles,
    ],
    ["creates", (spec) => spec.events[0].creates],
    [
      "expected errors",
      (spec) => spec.events.find((event) => event.kind === "SIMULATE")
        .expectedErrors,
    ],
    [
      "instruction schema references",
      (spec) => spec.events[0].instructionSchemaIds,
    ],
  ];

  for (const [boundary, locate] of boundaries) {
    for (const [mutation, mutate] of noncanonicalArrayMutations) {
      const spec = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
      mutate(locate(spec));
      assertSpecRejected(spec, /canonical .*array/, `${boundary}: ${mutation}`);
    }
  }
});

test("only the canonical V1 unauthorized check may retain one inert null token", () => {
  assert.equal(
    validateExecutionSpec(BUSINESS_FLOW_EXECUTION_SPEC),
    BUSINESS_FLOW_EXECUTION_SPEC,
  );
  assert.equal(
    executionSpecHash(),
    "6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac",
  );

  const canonicalEvent = BUSINESS_FLOW_EXECUTION_SPEC.events.find(
    (event) => event.id === "unauthorized_release",
  );
  assert.deepEqual(effectiveExpectedErrorNames(canonicalEvent), [
    "InvalidContributorTokenOwner",
    "ConstraintHasOne",
  ]);

  const otherEvent = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  otherEvent.events
    .find((event) => event.id === "refund_before_expiry")
    .expectedErrors.push(null);
  assertSpecRejected(otherEvent, /legacy expected-error token/, "other event");

  const duplicate = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  duplicate.events
    .find((event) => event.id === "unauthorized_release")
    .expectedErrors.push(null);
  assertSpecRejected(duplicate, /legacy expected-error token/, "duplicate null");

  const reordered = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  reordered.events.find(
    (event) => event.id === "unauthorized_release",
  ).expectedErrors = [
    "ConstraintHasOne",
    "InvalidContributorTokenOwner",
    null,
  ];
  assertSpecRejected(reordered, /legacy expected-error token/, "reordered tuple");

  const nullOnly = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  nullOnly.events.find(
    (event) => event.id === "unauthorized_release",
  ).expectedErrors = [null];
  assertSpecRejected(nullOnly, /recognized expected error/, "null-only tuple");

  const unknown = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  unknown.events.find(
    (event) => event.id === "refund_before_expiry",
  ).expectedErrors = ["UnknownProgramError"];
  assertSpecRejected(unknown, /recognized expected error/, "unknown identity");
});

test("canonical execution spec is deeply frozen data-only with exact accounting", () => {
  walk(BUSINESS_FLOW_EXECUTION_SPEC, (value) => {
    assert.notEqual(typeof value, "function");
    if (value !== null && typeof value === "object") assert.equal(Object.isFrozen(value), true);
  });

  const sends = BUSINESS_FLOW_EXECUTION_SPEC.events.filter((event) => event.kind === "SEND");
  const simulations = BUSINESS_FLOW_EXECUTION_SPEC.events.filter((event) => event.kind === "SIMULATE");
  const waits = BUSINESS_FLOW_EXECUTION_SPEC.events.filter((event) => event.kind === "WAIT");
  assert.equal(sends.length, 12);
  assert.equal(simulations.length, 3);
  assert.equal(waits.length, 1);
  assert.equal(sends.filter((event) => event.feePayerRole === "sponsor").length, 11);
  assert.equal(sends.filter((event) => event.feePayerRole === "maintainer").length, 1);
  assert.deepEqual(BUSINESS_FLOW_EXECUTION_SPEC.ceilings, { sends: 12, simulations: 3 });
  assert.deepEqual(BUSINESS_FLOW_EXECUTION_SPEC.inventory, {
    mint: 1,
    ata: 2,
    escrow: 3,
    vault: 3,
  });
  assert.deepEqual(sends.map((event) => event.id), [
    "setup:create_mint",
    "setup:sponsor_ata",
    "setup:contributor_ata",
    "setup:mint_tokens",
    "release:initialize",
    "release:fund",
    "release:release",
    "refund:initialize",
    "refund:fund",
    "refund:refund",
    "cancel:initialize",
    "cancel:cancel",
  ]);
  assert.deepEqual(simulations.map((event) => event.id), [
    "unauthorized_release",
    "refund_before_expiry",
    "release_at_or_after_expiry",
  ]);
  assert.match(executionSpecHash(), /^[0-9a-f]{64}$/);
  assert.equal(executionSpecHash(), executionSpecHash());
});

test("canonical execution spec hash ignores object-key insertion order", () => {
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .reverse()
          .map(([key, child]) => [key, reverseKeys(child)]),
      );
    }
    return value;
  };
  const reordered = reverseKeys(structuredClone(BUSINESS_FLOW_EXECUTION_SPEC));
  assert.equal(validateExecutionSpec(reordered), reordered);
  assert.equal(executionSpecHash(reordered), executionSpecHash());
});

test("execution spec rejects malformed event identity, order, kind, roles, and contributions", () => {
  const invalid = [
    [
      "unknown event field",
      mutatedSpec((spec) => {
        spec.events[0].runtimeOnly = true;
      }),
    ],
    [
      "unknown operation kind",
      mutatedSpec((spec) => {
        spec.events[0].kind = "DELETE";
      }),
    ],
    [
      "duplicate event ID",
      mutatedSpec((spec) => {
        spec.events[1].id = spec.events[0].id;
      }),
    ],
    [
      "noncontiguous event order",
      mutatedSpec((spec) => {
        spec.events[0].order = 99;
      }),
    ],
    [
      "contradictory send contribution",
      mutatedSpec((spec) => {
        spec.events[0].sendContribution = 0;
      }),
    ],
    [
      "unknown fee-payer role",
      mutatedSpec((spec) => {
        spec.events[0].feePayerRole = "unknown";
      }),
    ],
    [
      "unknown signer role",
      mutatedSpec((spec) => {
        spec.events[0].requiredNonPayerSignerRoles = ["unknown"];
      }),
    ],
  ];
  for (const [label, spec] of invalid) {
    assertSpecRejected(spec, /execution spec event/, label);
  }
});

test("execution spec rejects malformed enabled flows and derived accounting", () => {
  const invalid = [
    [
      "duplicate enabled flow",
      mutatedSpec((spec) => {
        spec.enabledFlows = ["release", "release", "cancel"];
      }),
      /enabled flows/,
    ],
    [
      "unknown enabled flow",
      mutatedSpec((spec) => {
        spec.enabledFlows = ["release", "refund", "unknown"];
      }),
      /enabled flows/,
    ],
    [
      "zero ceilings",
      mutatedSpec((spec) => {
        spec.ceilings = { sends: 0, simulations: 0 };
      }),
      /ceilings/,
    ],
    [
      "zero inventory",
      mutatedSpec((spec) => {
        spec.inventory = { mint: 0, ata: 0, escrow: 0, vault: 0 };
      }),
      /inventory/,
    ],
  ];
  for (const [label, spec, category] of invalid) {
    assertSpecRejected(spec, category, label);
  }
});

test("execution spec enforces operation-kind contracts and dynamic policy ownership", () => {
  const invalid = [
    [
      "send without builder",
      mutatedSpec((spec) => {
        spec.events[0].instructionBuilderId = null;
      }),
    ],
    [
      "send with simulation decoder",
      mutatedSpec((spec) => {
        spec.events[0].simulationDecoderId = "anchor-error-v1";
      }),
    ],
    [
      "simulation without expected errors",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.kind === "SIMULATE").expectedErrors = [];
      }),
    ],
    [
      "simulation with post-state verifier",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.kind === "SIMULATE").postStateVerifierId =
          "unexpected-v1";
      }),
    ],
    [
      "wait with transaction builder",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.kind === "WAIT").instructionBuilderId =
          "unexpected-v1";
      }),
    ],
    [
      "dynamic instruction without expiry policy",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.id === "release:initialize").expiryPolicyRole =
          null;
      }),
    ],
    [
      "static instruction with expiry policy",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.id === "release:fund").expiryPolicyRole =
          "release";
      }),
    ],
    [
      "cross-flow dynamic expiry policy",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.id === "release:initialize")
          .expiryPolicyRole = "refund";
      }),
    ],
    [
      "creation rent payer differs from transaction fee payer",
      mutatedSpec((spec) => {
        spec.events.find((event) => event.id === "setup:create_mint").rentPayerRole =
          "maintainer";
      }),
    ],
  ];
  for (const [label, spec] of invalid) {
    assertSpecRejected(spec, /execution spec event/, label);
  }
});

test("execution spec rejects incomplete top-level data and noncanonical event arrays", () => {
  const invalid = [
    [
      "missing top-level inventory",
      mutatedSpec((spec) => {
        delete spec.inventory;
      }),
      /top-level fields/,
    ],
    [
      "unknown event flow",
      mutatedSpec((spec) => {
        spec.events[0].flow = "unknown";
      }),
      /execution spec event/,
    ],
    [
      "duplicate instruction schema reference",
      mutatedSpec((spec) => {
        const event = spec.events.find((candidate) => candidate.id === "release:fund");
        event.instructionSchemaIds.push(event.instructionSchemaIds[0]);
        event.instructionCount += 1;
      }),
      /execution spec event/,
    ],
    [
      "sparse enabled flows",
      mutatedSpec((spec) => {
        delete spec.enabledFlows[2];
      }),
      /enabled flows/,
    ],
    [
      "sparse signer roles",
      mutatedSpec((spec) => {
        spec.events[0].requiredNonPayerSignerRoles = ["sponsor"];
        delete spec.events[0].requiredNonPayerSignerRoles[0];
      }),
      /execution spec event/,
    ],
    [
      "sparse expected errors",
      mutatedSpec((spec) => {
        delete spec.events.find((event) => event.kind === "SIMULATE")
          .expectedErrors[0];
      }),
      /execution spec event/,
    ],
    [
      "sparse enabled flows disguised by named property",
      mutatedSpec((spec) => {
        delete spec.enabledFlows[2];
        spec.enabledFlows.extra = "cancel";
      }),
      /enabled flows/,
    ],
    [
      "sparse signer roles disguised by named property",
      mutatedSpec((spec) => {
        spec.events[0].requiredNonPayerSignerRoles = ["maintainer"];
        delete spec.events[0].requiredNonPayerSignerRoles[0];
        spec.events[0].requiredNonPayerSignerRoles.extra = "maintainer";
      }),
      /execution spec event/,
    ],
  ];
  for (const [label, spec, category] of invalid) {
    assertSpecRejected(spec, category, label);
  }
});

test("registry validation requires exact stable IDs and rejects duplicate or extra entries", () => {
  const valid = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  const result = validateExecutionRegistry(valid);
  assert.equal(result.builders instanceof Map, true);

  for (const section of Object.keys(valid)) {
    const missing = Object.fromEntries(
      Object.entries(valid).map(([key, entries]) => [key, [...entries]]),
    );
    missing[section].pop();
    assert.throws(() => validateExecutionRegistry(missing), /registry/);

    const duplicate = Object.fromEntries(
      Object.entries(valid).map(([key, entries]) => [key, [...entries]]),
    );
    duplicate[section].push(duplicate[section][0]);
    assert.throws(() => validateExecutionRegistry(duplicate), /duplicate/);

    const extra = Object.fromEntries(
      Object.entries(valid).map(([key, entries]) => [key, [...entries]]),
    );
    extra[section].push(
      section === "builders"
        ? ["unknown-id", () => {}]
        : { id: "unknown-id", status: "deferred" },
    );
    assert.throws(() => validateExecutionRegistry(extra), /unreferenced/);
  }

  const disabled = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  const disabledBuilder = () => {};
  disabledBuilder.disabled = true;
  disabled.builders[0] = [disabled.builders[0][0], disabledBuilder];
  assert.throws(() => validateExecutionRegistry(disabled), /malformed/);
});

test("registry rejects noncanonical section and builder tuple arrays", () => {
  for (const section of ["builders", "verifiers", "simulations", "waits"]) {
    for (const [label, mutate] of noncanonicalArrayMutations) {
      const registry = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
      mutate(registry[section]);
      assert.throws(
        () => validateExecutionRegistry(registry),
        /canonical .*array/,
        `${section}: ${label}`,
      );
    }
  }

  for (const [label, mutate] of noncanonicalArrayMutations) {
    const registry = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
    mutate(registry.builders[0]);
    assert.throws(
      () => validateExecutionRegistry(registry),
      /canonical .*array/,
      `builder tuple: ${label}`,
    );
  }

  const registry = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  registry.extra = [];
  assert.throws(
    () => validateExecutionRegistry(registry),
    /exactly builders, verifiers, simulations, and waits/,
  );
});

test("spec rejects mutation and does not hash registry implementation functions", () => {
  assert.throws(
    () => BUSINESS_FLOW_EXECUTION_SPEC.events.push({ id: "hidden:send" }),
    TypeError,
  );
  const first = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  const second = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  second.builders = second.builders.map(([id]) => [id, () => "different closure"]);
  validateExecutionRegistry(first);
  validateExecutionRegistry(second);
  assert.equal(executionSpecHash(), executionSpecHash());
});

test("deferred integration references cannot be satisfied by placeholder functions", () => {
  const registry = registryFor(BUSINESS_FLOW_EXECUTION_SPEC);
  registry.verifiers = registry.verifiers.map(({ id }) => [id, () => undefined]);
  assert.throws(
    () => validateExecutionRegistry(registry),
    /falsely claims implemented integration/,
  );
});

test("execution spec hash binds reachable canonical instruction semantics", () => {
  assert.ok(BUSINESS_FLOW_EXECUTION_SPEC.instructionSchemas.length >= 9);
  validateExecutionSpec(BUSINESS_FLOW_EXECUTION_SPEC);
  for (const event of BUSINESS_FLOW_EXECUTION_SPEC.events) {
    assert.equal(event.instructionSchemaIds.length, event.instructionCount);
  }

  const mutations = [
    (spec) => {
      spec.instructionSchemas[0].discriminator = "ffffffff";
    },
    (spec) => {
      spec.instructionSchemas[0].accounts.reverse();
    },
    (spec) => {
      spec.instructionSchemas[0].accounts[0].isSigner =
        !spec.instructionSchemas[0].accounts[0].isSigner;
    },
    (spec) => {
      spec.instructionSchemas[0].accounts[0].isWritable =
        !spec.instructionSchemas[0].accounts[0].isWritable;
    },
    (spec) => {
      spec.instructionSchemas[0].dataLength += 1;
    },
    (spec) => {
      const dynamic = spec.instructionSchemas.find(
        (schema) => schema.dynamicFields.length > 0,
      );
      dynamic.dynamicFields[0].offset += 1;
    },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
    mutate(changed);
    assert.notEqual(executionSpecHash(changed), executionSpecHash());
  }

  const runtimeOnly = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  runtimeOnly.recentBlockhash = "runtime-only";
  runtimeOnly.concreteExpiry = "1800000100";
  assert.throws(() => validateExecutionSpec(runtimeOnly), /unknown top-level field/);

  const duplicate = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  duplicate.instructionSchemas.push(
    structuredClone(duplicate.instructionSchemas[0]),
  );
  assert.throws(() => validateExecutionSpec(duplicate), /duplicate instruction schema/);

  const unreachable = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  unreachable.instructionSchemas.push({
    ...structuredClone(unreachable.instructionSchemas[0]),
    id: "unreachable-v1",
  });
  assert.throws(() => validateExecutionSpec(unreachable), /unreachable instruction schema/);

  const missing = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  missing.events[0].instructionSchemaIds[0] = "missing-v1";
  assert.throws(() => validateExecutionSpec(missing), /unknown instruction schema/);
});

test("execution spec rejects malformed dynamic-field geometry before hashing", () => {
  const mutateDynamic = (mutate) => {
    const spec = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
    const schema = spec.instructionSchemas.find(
      (candidate) => candidate.dynamicFields.length > 0,
    );
    mutate(schema.dynamicFields, schema);
    return spec;
  };
  const invalid = [
    mutateDynamic((fields) => fields.push({ ...fields[0], name: "overlap", offset: 52 })),
    mutateDynamic((fields) => { fields[0].offset = 119; }),
    mutateDynamic((fields) => { fields[0].offset = -1; }),
    mutateDynamic((fields) => { fields[0].length = 0; }),
    mutateDynamic((fields) => { fields[0].offset = 48.5; }),
    mutateDynamic((fields) => { fields[0].length = 8.5; }),
    mutateDynamic((fields) => fields.push({ ...fields[0] })),
    mutateDynamic((fields) => { fields[0].type = "u128le"; }),
    mutateDynamic((fields) => { fields[0].length = 7; }),
    mutateDynamic((fields) => { fields[0].offset = 4; }),
    mutateDynamic((fields) => { delete fields[0].policyRole; }),
    mutateDynamic((fields) => { fields[0].policyRole = "unknown"; }),
  ];
  for (const spec of invalid) {
    assert.throws(() => validateExecutionSpec(spec), /instruction schema/);
    assert.throws(() => executionSpecHash(spec), /instruction schema/);
  }
  validateExecutionSpec(BUSINESS_FLOW_EXECUTION_SPEC);
});

test("execution spec rejects unknown, duplicate, and contradictory account roles", () => {
  const unknown = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  unknown.instructionSchemas[0].accounts[0].role = "unknown";
  assert.throws(() => validateExecutionSpec(unknown), /account role/);

  const duplicate = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  duplicate.instructionSchemas[0].accounts[1].role =
    duplicate.instructionSchemas[0].accounts[0].role;
  assert.throws(() => validateExecutionSpec(duplicate), /account role/);

  const unknownProgram = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  unknownProgram.instructionSchemas[0].programRole = "unknown";
  assert.throws(() => validateExecutionSpec(unknownProgram), /instruction schema/);
});

test("execution spec bounds discriminator length by total instruction data", () => {
  const invalidLayouts = [
    { dataLength: 0, discriminatorLength: 1, discriminator: "01" },
    {
      dataLength: 4,
      discriminatorLength: 8,
      discriminator: "0102030405060708",
    },
  ];
  for (const layout of invalidLayouts) {
    const spec = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
    Object.assign(spec.instructionSchemas[0], layout);
    assert.throws(
      () => validateExecutionSpec(spec),
      /discriminator length exceeds data length/,
    );
    assert.throws(
      () => executionSpecHash(spec),
      /discriminator length exceeds data length/,
    );
  }

  const ata = BUSINESS_FLOW_EXECUTION_SPEC.instructionSchemas.find(
    (schema) => schema.id ===
      "associated-token-create-idempotence-not-required-v1",
  );
  assert.equal(ata.dataLength, 0);
  assert.equal(ata.discriminatorLength, 0);
  assert.equal(ata.discriminator, "");
  assert.deepEqual(ata.dynamicFields, []);

  const initialize = BUSINESS_FLOW_EXECUTION_SPEC.instructionSchemas.find(
    (schema) => schema.id === "escrow-initialize-v1",
  );
  assert.equal(initialize.dataLength, 120);
  assert.equal(initialize.discriminatorLength, 8);
  assert.equal(initialize.discriminator, "f3a04d990b5c30d1");
  assert.equal(
    executionSpecHash(),
    "6eef9c1959792ba6b111a0b1cd4259e70c6e2f72e74d68034e3d92cc4f3531ac",
  );

  const mismatchedBytes = structuredClone(BUSINESS_FLOW_EXECUTION_SPEC);
  mismatchedBytes.instructionSchemas[0].discriminator = "03";
  assert.throws(() => validateExecutionSpec(mismatchedBytes), /instruction schema/);
  assert.throws(() => executionSpecHash(mismatchedBytes), /instruction schema/);
});
