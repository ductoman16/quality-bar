import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryCollection } from "../src/repository-collection.js";

function repositoryResources() {
  return [...Array(101).keys()].map((index) => ({
    id: `repository-${String(index).padStart(3, "0")}`,
    url: `https://example.com/repository-${String(index).padStart(3, "0")}.git`,
  }));
}

test("Repository discovery uses stable validated opaque keyset cursors", () => {
  const repositories = repositoryResources();
  /** @type {Array<{after: {id: string, url: string} | null, limit: number}>} */
  const reads = [];
  /** @param {{after: {id: string, url: string} | null, limit: number}} query */
  const readPage = ({ after, limit }) => {
    reads.push({ after, limit });
    const start =
      after === null
        ? 0
        : repositories.findIndex(
            ({ id, url }) => id === after.id && url === after.url,
          ) + 1;
    return repositories.slice(start, start + limit);
  };
  const masterKey = Buffer.alloc(32, 4);
  const collection = createRepositoryCollection(masterKey, readPage);

  const firstPage = collection.read();
  assert.equal(firstPage.items.length, 50);
  assert.equal(typeof firstPage.next_cursor, "string");
  assert.deepEqual(reads[0], { after: null, limit: 51 });
  assert.doesNotMatch(
    /** @type {string} */ (firstPage.next_cursor),
    /repository|example/,
  );

  const resumedCollection = createRepositoryCollection(masterKey, readPage);
  const secondPage = resumedCollection.read({
    cursor: /** @type {string} */ (firstPage.next_cursor),
    limit: "50",
  });
  assert.equal(secondPage.items.length, 50);
  assert.deepEqual(reads[1], {
    after: repositories[49],
    limit: 51,
  });
  assert.equal(typeof secondPage.next_cursor, "string");

  const finalPage = resumedCollection.read({
    cursor: /** @type {string} */ (secondPage.next_cursor),
    limit: "100",
  });
  assert.deepEqual(finalPage, {
    items: [repositories[100]],
    next_cursor: null,
  });
  assert.deepEqual(reads[2], {
    after: repositories[99],
    limit: 101,
  });

  assert.throws(() => collection.read({ limit: "101" }), {
    code: "page_size_invalid",
    message: "Repository collection limit must be between 1 and 100",
  });
  const foreignCollection = createRepositoryCollection(
    Buffer.alloc(32, 5),
    readPage,
  );
  assert.throws(
    () =>
      foreignCollection.read({
        cursor: /** @type {string} */ (firstPage.next_cursor),
      }),
    {
      code: "cursor_invalid",
      message: "Repository collection cursor is invalid",
    },
  );

  collection.destroy();
  resumedCollection.destroy();
  foreignCollection.destroy();
});
