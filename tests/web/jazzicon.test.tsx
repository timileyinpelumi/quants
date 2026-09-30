import { test, expect } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Jazzicon } from "../../src/web/ui/Jazzicon";

test("the same address always draws the same icon, different addresses differ", () => {
  const a = renderToStaticMarkup(<Jazzicon address="6VUvgZLysRXrdcWLj5K1bvNnSXtSQo8pet1LZ9PK9KcX" />);
  expect(renderToStaticMarkup(<Jazzicon address="6VUvgZLysRXrdcWLj5K1bvNnSXtSQo8pet1LZ9PK9KcX" />)).toBe(a);
  expect(renderToStaticMarkup(<Jazzicon address="HRdUdnQbbVJ1FViR1x2Bs8fv3Bq2ADrFJob4dBCxWuJT" />)).not.toBe(a);
  expect(a.match(/<rect/g)!.length).toBe(3);
});
