const {
  csrfToken: repositoryDeletionCsrfToken,
  displayMutationFailure: displayRepositoryDeletionFailure,
  error: repositoryDeletionError,
  requiredElement: requiredRepositoryDeletionElement,
} = /** @type {{
 *   csrfToken: () => string,
 *   displayMutationFailure: (response: Response) => Promise<void>,
 *   error: HTMLElement,
 *   requiredElement: (id: string) => HTMLElement
 * }} */ (Reflect.get(window, "qualityBarOperator"));
const repositoryDeletionResources = /** @type {{
 *   confirmationIdentity: (id: string) => string | undefined,
 *   find: (id: string) => {deletion_eligible: boolean, id: string, url: string} | undefined,
 *   ready: () => Promise<unknown>,
 *   refresh: () => Promise<boolean>,
 *   syncDeleteAvailability: () => void
 * }} */ (Reflect.get(window, "qualityBarRepositories"));

const repositoryDelete = /** @type {HTMLButtonElement} */ (
  requiredRepositoryDeletionElement("repository-delete")
);
const repositoryDeleteConfirmation = /** @type {HTMLDialogElement} */ (
  requiredRepositoryDeletionElement("repository-delete-confirmation")
);
const repositoryDeleteConfirmationForm = /** @type {HTMLFormElement} */ (
  requiredRepositoryDeletionElement("repository-delete-confirmation-form")
);
const repositoryDeleteConfirmationInput = /** @type {HTMLInputElement} */ (
  requiredRepositoryDeletionElement("repository-delete-confirmation-input")
);
const repositoryDeleteConfirmationMessage = requiredRepositoryDeletionElement(
  "repository-delete-confirmation-message",
);
const repositoryDeleteConfirmationCancel = /** @type {HTMLButtonElement} */ (
  requiredRepositoryDeletionElement("repository-delete-confirmation-cancel")
);
/** @type {{id: string, identity: string, url: string} | null} */
let pendingRepositoryDeletion = null;

/**
 * @param {{id: string, url: string}} repository
 * @param {{allowSuccess?: boolean, unobservedMessage?: string}} [options]
 */
async function reconcileRepositoryDeletion(
  repository,
  { allowSuccess = false, unobservedMessage } = {},
) {
  if (!(await repositoryDeletionResources.refresh())) {
    repositoryDeletionError.focus();
    return;
  }
  if (allowSuccess && !repositoryDeletionResources.find(repository.id)) {
    repositoryDeletionError.hidden = true;
    const lifecycleResult = requiredRepositoryDeletionElement(
      "repository-lifecycle-result",
    );
    lifecycleResult.textContent = `${repository.url} deleted.`;
    lifecycleResult.focus();
    return;
  }
  if (unobservedMessage) {
    repositoryDeletionError.textContent = unobservedMessage;
    repositoryDeletionError.hidden = false;
  }
  repositoryDeletionError.focus();
}

async function deletePendingRepository() {
  const repository = pendingRepositoryDeletion;
  if (!repository) {
    return;
  }
  if (repositoryDeleteConfirmationInput.value !== repository.identity) {
    repositoryDeletionError.textContent =
      "Type the Repository identity to confirm permanent deletion";
    repositoryDeletionError.hidden = false;
    repositoryDeleteConfirmationInput.focus();
    return;
  }
  pendingRepositoryDeletion = null;
  repositoryDeleteConfirmation.close();
  repositoryDeletionError.hidden = true;
  repositoryDelete.disabled = true;
  try {
    let response;
    try {
      response = await fetch(
        `/api/v1/repositories/${encodeURIComponent(repository.id)}`,
        {
          body: "{}",
          headers: {
            "content-type": "application/json",
            "x-quality-bar-csrf": repositoryDeletionCsrfToken(),
          },
          method: "DELETE",
        },
      );
    } catch {
      repositoryDeletionError.textContent = "Repository deletion failed";
      repositoryDeletionError.hidden = false;
      await reconcileRepositoryDeletion(repository);
      return;
    }
    if (!response.ok) {
      await displayRepositoryDeletionFailure(response);
      await reconcileRepositoryDeletion(repository);
      return;
    }
    await reconcileRepositoryDeletion(repository, {
      allowSuccess: true,
      unobservedMessage: "Repository deletion was not observed",
    });
  } finally {
    repositoryDeletionResources.syncDeleteAvailability();
  }
}

function cancelRepositoryDeletion() {
  pendingRepositoryDeletion = null;
  repositoryDeleteConfirmation.close();
  repositoryDelete.focus();
}

repositoryDelete.addEventListener("click", async () => {
  if (!(await repositoryDeletionResources.ready())) {
    return;
  }
  const repositoryId = /** @type {HTMLSelectElement} */ (
    requiredRepositoryDeletionElement("repository-lifecycle-repository")
  ).value;
  const repository = repositoryDeletionResources.find(repositoryId);
  if (!repository) {
    throw new Error("repository_delete_target_missing");
  }
  if (!repository.deletion_eligible) {
    return;
  }
  const identity =
    repositoryDeletionResources.confirmationIdentity(repositoryId);
  if (typeof identity !== "string" || identity.length === 0) {
    throw new Error("repository_delete_identity_missing");
  }
  pendingRepositoryDeletion = { ...repository, identity };
  repositoryDeletionError.hidden = true;
  repositoryDeleteConfirmationMessage.textContent = `Delete ${identity} permanently. This cannot be undone.`;
  repositoryDeleteConfirmationInput.value = "";
  repositoryDeleteConfirmation.showModal();
  repositoryDeleteConfirmationInput.focus();
});
repositoryDeleteConfirmationCancel.addEventListener(
  "click",
  cancelRepositoryDeletion,
);
repositoryDeleteConfirmation.addEventListener("cancel", (event) => {
  event.preventDefault();
  cancelRepositoryDeletion();
});
repositoryDeleteConfirmationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await deletePendingRepository();
});
