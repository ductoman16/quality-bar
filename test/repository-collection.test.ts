import assert from "node:assert/strict";
import { test } from "node:test";

import { createRepositoryCollection } from "../src/repository/repository-collection.ts";

function repositoryResources() {
  return [...Array(101).keys()].map((index) => ({
    id: `repository-${String(index).padStart(3, "0")}`,
    url: `https://example.com/repository-${String(index).padStart(3, "0")}.git`,
  }));
}

test("Repository discovery uses stable validated opaque keyset cursors", () => {
  const repositories = repositoryResources();
  const reads: Array<{
    after: { id: string; url: string } | null;
    limit: number;
  }> = [];
  const readPage = ({
    after,
    limit,
  }: {
    after: { id: string; url: string } | null;
    limit: number;
  }) => {
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
  assert.doesNotMatch(firstPage.next_cursor as string, /repository|example/);

  const resumedCollection = createRepositoryCollection(masterKey, readPage);
  const secondPage = resumedCollection.read({
    cursor: firstPage.next_cursor as string,
    limit: "50",
  });
  assert.equal(secondPage.items.length, 50);
  assert.deepEqual(reads[1], {
    after: repositories[49],
    limit: 51,
  });
  assert.equal(typeof secondPage.next_cursor, "string");

  const finalPage = resumedCollection.read({
    cursor: secondPage.next_cursor as string,
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
        cursor: firstPage.next_cursor as string,
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
