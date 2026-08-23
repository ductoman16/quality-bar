const missingPublicationCapability = async () => {
  throw Object.assign(
    new Error("Forgejo publication capability is unavailable"),
    { code: "forgejo_publication_capability_unavailable" },
  );
};

/** @param {any} verifier */
export function forgejoPublicationCapabilities(verifier) {
  return {
    ...verifier,
    publishAggregateFeedback:
      verifier.publishAggregateFeedback ?? missingPublicationCapability,
    publishCommitStatus:
      verifier.publishCommitStatus ?? missingPublicationCapability,
    publishInlineFeedback:
      verifier.publishInlineFeedback ?? missingPublicationCapability,
    reconcileAggregateFeedback:
      verifier.reconcileAggregateFeedback ?? missingPublicationCapability,
    reconcileCommitStatus:
      verifier.reconcileCommitStatus ?? missingPublicationCapability,
    reconcileInlineFeedback:
      verifier.reconcileInlineFeedback ?? missingPublicationCapability,
  };
}
