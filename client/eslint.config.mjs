import parser from '@typescript-eslint/parser';
import plugin from '@typescript-eslint/eslint-plugin';
export default [{files:['**/*.{ts,tsx}'],languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},plugins:{'@typescript-eslint':plugin},rules:{...plugin.configs.recommended.rules,'@typescript-eslint/no-explicit-any':'off'}}];
