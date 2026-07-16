import { Agent } from "undici";

/**
 * Bun's undici Agent may lack `close()`. Local World's teardown calls it and
 * otherwise fails the Vitest suite after tests have already passed.
 */
const proto = Agent.prototype as { close?: () => unknown };
if (typeof proto.close !== "function") {
  proto.close = () => undefined;
}
