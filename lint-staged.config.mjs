export default {
  '*.ts': ['eslint --fix'],
  // Run tsc without file args (project mode) — the fn form suppresses path injection
  '**/*.ts': () => 'pnpm typecheck',
};
