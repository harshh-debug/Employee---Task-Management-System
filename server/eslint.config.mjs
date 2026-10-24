import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{files:['**/*.ts'],languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module'}},plugins:{'@typescript-eslint':plugin},rules:{...plugin.configs.recommended.rules,'@typescript-eslint/no-explicit-any':'off'}}];
