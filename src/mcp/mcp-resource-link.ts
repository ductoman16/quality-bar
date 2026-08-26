export function mcpResourceLink(kind: string, id: string) {
  return {
    mimeType: "application/json",
    name: id,
    type: "resource_link",
    uri: `quality-bar://v1/${kind}/${encodeURIComponent(id)}`,
  };
}
