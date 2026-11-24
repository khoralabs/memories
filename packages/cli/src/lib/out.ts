export const out = (asJson: boolean, value: unknown, text: string) =>
  console.log(asJson ? JSON.stringify(value, null, 2) : text);
