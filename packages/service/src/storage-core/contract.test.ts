import {
  runMemoriesDatabaseOntologyStoreContractTests,
  runMemoriesDatabasePlacementStoreContractTests,
} from "../testing/index";
import { createInMemoryOntologyStore, createInMemoryPlacementStore } from "./index";

runMemoriesDatabasePlacementStoreContractTests("in-memory", () =>
  createInMemoryPlacementStore({
    defaultStrategy: { kind: "sqlite", dataDir: "/tmp/in-memory-default" },
  }),
);

runMemoriesDatabaseOntologyStoreContractTests("in-memory", () => createInMemoryOntologyStore());
