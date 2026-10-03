import { test, expect } from "bun:test";
import { isReservedName } from "../../src/domain/reserved";

test("quants in a name or symbol is reserved, however it is spelled", () => {
  for (const t of ["QUANTS", "quants", "Quants Coin", "MyQuantsToken", "Q U A N T S", "q.u.a.n.t.s", "QUANT5", "baby-quants"]) expect(isReservedName(t)).toBe(true);
  for (const t of ["QUANT", "Quantum", "Cat Coin", "QNT", "Squad"]) expect(isReservedName(t)).toBe(false);
});
