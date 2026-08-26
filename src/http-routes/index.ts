import { analyticsRoutes, analyticsSchemas } from "./analytics.ts";
import { evaluationsRoutes, evaluationsSchemas } from "./evaluations.ts";
import { forgejoRoutes, forgejoSchemas } from "./forgejo.ts";
import { githubRoutes, githubSchemas } from "./github.ts";
import { onboardingRoutes, onboardingSchemas } from "./onboarding.ts";
import { repositoriesRoutes, repositoriesSchemas } from "./repositories.ts";
import { reviewsRoutes, reviewsSchemas } from "./reviews.ts";
import { sessionsRoutes, sessionsSchemas } from "./sessions.ts";
import { systemRoutes, systemSchemas } from "./system.ts";
import { waiversRoutes, waiversSchemas } from "./waivers.ts";

export const apiRoutes = [
  ...analyticsRoutes,
  ...evaluationsRoutes,
  ...forgejoRoutes,
  ...githubRoutes,
  ...onboardingRoutes,
  ...repositoriesRoutes,
  ...reviewsRoutes,
  ...sessionsRoutes,
  ...systemRoutes,
  ...waiversRoutes,
];

export const apiSchemas = {
  ...analyticsSchemas,
  ...evaluationsSchemas,
  ...forgejoSchemas,
  ...githubSchemas,
  ...onboardingSchemas,
  ...repositoriesSchemas,
  ...reviewsSchemas,
  ...sessionsSchemas,
  ...systemSchemas,
  ...waiversSchemas,
};
