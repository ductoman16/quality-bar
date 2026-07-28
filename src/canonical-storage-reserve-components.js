import { closedObject } from "./canonical-schema.js";

export function canonicalStorageReserveSchemas() {
  return {
    StorageReserveFact: closedObject(
      {
        filesystems: {
          items: {
            $ref: "#/components/schemas/StorageReserveFilesystemFact",
          },
          maxItems: 2,
          minItems: 2,
          type: "array",
        },
        reserve_bytes: { minimum: 1, type: "integer" },
        status: {
          enum: ["available", "unavailable"],
          type: "string",
        },
      },
      ["filesystems", "reserve_bytes", "status"],
    ),
    StorageReserveFilesystemFact: closedObject(
      {
        available_bytes: { minimum: 0, type: "integer" },
        filesystem: {
          enum: ["state", "checkouts"],
          type: "string",
        },
        path: { minLength: 1, type: "string" },
        status: {
          enum: ["available", "unavailable"],
          type: "string",
        },
      },
      ["available_bytes", "filesystem", "path", "status"],
    ),
  };
}
