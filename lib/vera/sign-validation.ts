export type SignBody = {
  signer_name: string;
  signer_representing: string;
  agree: boolean;
};

type ValidationOk = { ok: true; body: SignBody };
type ValidationFail = { ok: false; status: number; error: string };
export type ValidationResult = ValidationOk | ValidationFail;

export function validateSignBody(b: unknown): ValidationResult {
  if (typeof b !== "object" || b === null) {
    return { ok: false, status: 400, error: "Invalid JSON" };
  }
  const x = b as Record<string, unknown>;
  if (typeof x.signer_name !== "string" || x.signer_name.trim() === "") {
    return { ok: false, status: 400, error: "Name and 'representing' are required" };
  }
  if (typeof x.signer_representing !== "string" || x.signer_representing.trim() === "") {
    return { ok: false, status: 400, error: "Name and 'representing' are required" };
  }
  if (x.agree !== true) {
    return { ok: false, status: 400, error: "You must confirm authority to sign" };
  }
  return {
    ok: true,
    body: {
      signer_name: x.signer_name.trim(),
      signer_representing: x.signer_representing.trim(),
      agree: true,
    },
  };
}
