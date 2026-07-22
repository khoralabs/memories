import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true, strict: false });

export function validatePropsAgainstJsonSchema(
  schemaJson: string | null | undefined,
  props: Record<string, unknown>,
): void {
  if (schemaJson == null || schemaJson === "") return;
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(schemaJson) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`Invalid JSON Schema on catalog row: ${e}`);
  }
  // Zod’s `toJSONSchema()` sets `$schema` to Draft 2020-12; default Ajv resolves that URL as a
  // missing ref. Strip it — instance validation does not need the meta-schema declaration.
  delete schema.$schema;
  const validate = ajv.compile(schema);
  if (!validate(props)) {
    throw new Error(
      `Label props failed JSON Schema validation: ${ajv.errorsText(validate.errors)}`,
    );
  }
}
