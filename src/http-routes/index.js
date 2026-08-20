import { analyticsRoutes, analyticsSchemas } from "./analytics.js";
import { evaluationsRoutes, evaluationsSchemas } from "./evaluations.js";
import { forgejoRoutes, forgejoSchemas } from "./forgejo.js";
import { githubRoutes, githubSchemas } from "./github.js";
import { onboardingRoutes, onboardingSchemas } from "./onboarding.js";
import { repositoriesRoutes, repositoriesSchemas } from "./repositories.js";
import { reviewsRoutes, reviewsSchemas } from "./reviews.js";
import { sessionsRoutes, sessionsSchemas } from "./sessions.js";
import { systemRoutes, systemSchemas } from "./system.js";
import { waiversRoutes, waiversSchemas } from "./waivers.js";

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
