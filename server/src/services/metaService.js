export function createMetaService({ repos }) {
  return {
    listBranches: () => repos.meta.listBranches(),
    listHealthIssues: () => repos.meta.listHealthIssues(),
  };
}
