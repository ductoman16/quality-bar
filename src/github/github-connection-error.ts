export class GitHubConnectionError extends Error {
  name: "GitHubConnectionError";
  code: string;
  affectedRepositoryIds?: any;
  completedRepositoryIds?: any;
  commit?: any;
  repositoryEvidence?: any;
  repositoryId?: number;
  nextAttemptAt?: number;
  responseStatus?: number;

  constructor(
    code: string,
    message: string,
    options?: ErrorOptions & {
      affectedRepositoryIds?: number[];
      commit?: (transaction: any) => void;
      completedRepositoryIds?: number[];
      nextAttemptAt?: number;
      repositoryEvidence?: unknown[];
      repositoryId?: number;
      responseStatus?: number;
    },
  ) {
    super(message, options);
    this.name = "GitHubConnectionError";
    this.code = code;
    if (Array.isArray(options?.affectedRepositoryIds)) {
      this.affectedRepositoryIds = options.affectedRepositoryIds;
    }
    if (Array.isArray(options?.completedRepositoryIds)) {
      this.completedRepositoryIds = options.completedRepositoryIds;
    }
    if (typeof options?.commit === "function") {
      this.commit = options.commit;
    }
    if (Array.isArray(options?.repositoryEvidence)) {
      this.repositoryEvidence = options.repositoryEvidence;
    }
    if (Number.isSafeInteger(options?.repositoryId)) {
      this.repositoryId = options?.repositoryId as number;
    }
    if (Number.isSafeInteger(options?.nextAttemptAt)) {
      this.nextAttemptAt = options?.nextAttemptAt as number;
    }
    if (Number.isSafeInteger(options?.responseStatus)) {
      this.responseStatus = options?.responseStatus as number;
    }
  }
}

export function failGitHubConnection(
  code: string,
  message: string,
  cause?: unknown,
): never {
  throw new GitHubConnectionError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
