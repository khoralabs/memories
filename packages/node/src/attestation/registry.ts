import type { ContributorAttestation } from "./attestation";
import { validateContributorAttestation } from "./attestation";

export type ContributorAttestationVerification = {
  format: string;
  principal: string;
  verified: true;
};

export type ContributorAttestationVerifier = (
  attestation: ContributorAttestation,
) => ContributorAttestationVerification | Promise<ContributorAttestationVerification>;

export type ContributorAttestationVerifierRegistry = Record<string, ContributorAttestationVerifier>;

export async function verifyContributorAttestation(
  attestation: unknown,
  registry: ContributorAttestationVerifierRegistry,
): Promise<ContributorAttestationVerification> {
  const parsed = validateContributorAttestation(attestation);
  const verifier = registry[parsed.format];
  if (verifier === undefined) {
    throw new Error(`No verifier registered for contributor attestation format: ${parsed.format}`);
  }
  const verification = await verifier(parsed);
  if (verification.verified !== true) {
    throw new Error("Contributor attestation verifier returned an unverified result");
  }
  if (verification.format !== parsed.format) {
    throw new Error("Contributor attestation verifier returned a mismatched format");
  }
  if (verification.principal !== parsed.principal) {
    throw new Error("Contributor attestation verifier returned a mismatched principal");
  }
  return verification;
}
