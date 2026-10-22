import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../utils/AppError.js";

test("AppError cra una instancia correcta", () => {
  const err = new AppError("No encontrado", 404);

  assert.ok(err instanceof Error);
  assert.ok(err instanceof AppError);
  assert.equal(err.message, "No encontrado");
  assert.equal(err.statusCode, 404);
  assert.equal(err.isOperational, true);
  assert.ok(err.stack, undefined);
});

test("hereda correctamente de Error", () => {
  const err = new AppError("boom", 500);
  assert.equal(err.name, "Error");
  assert.equal(Object.getPrototypeOf(err), AppError.prototype);
});
