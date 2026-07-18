import {
  runMemoriesDatabaseOntologyStoreContractTests,
  runMemoriesDatabasePlacementStoreContractTests,
} from "@khoralabs/memories-service-storage-contract";
import {
  createInMemoryOntologyStore,
  createInMemoryPlacementStore,
} from "@khoralabs/memories-service-storage-core";

runMemoriesDatabasePlacementStoreContractTests("in-memory", () =>
  createInMemoryPlacementStore({
    defaultStrategy: { kind: "sqlite", dataDir: "/tmp/in-memory-default" },
  }),
);

runMemoriesDatabaseOntologyStoreContractTests("in-memory", () => createInMemoryOntologyStore());
