/**
 * @param {string} kind
 * @param {string} id
 */
export function mcpResourceLink(kind, id) {
  return {
    mimeType: "application/json",
    name: id,
    type: "resource_link",
    uri: `quality-bar://v1/${kind}/${encodeURIComponent(id)}`,
  };
}
