import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x'
import eslintPluginUnicorn from 'eslint-plugin-unicorn'
import eslintPluginImportX from 'eslint-plugin-import-x'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import react from 'eslint-plugin-react'
import i18next from 'eslint-plugin-i18next';
import eslintPluginComments from 'eslint-plugin-eslint-comments';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      js.configs.recommended,
      tseslint.configs.recommended,
      reactX.configs.recommended,
      eslintPluginUnicorn.configs['flat/recommended'],
      eslintPluginImportX.flatConfigs.recommended,
      eslintPluginImportX.flatConfigs.typescript,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        projectService: {
          noWarnOnMultipleProjects: true,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: ['./tsconfig.json', './tsconfig.client.json', './tsconfig.server.json'],
        },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'react': react,
      'i18next': i18next, 
      'eslint-comments': eslintPluginComments
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'eslint-comments/no-unused-disable': 'error',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      'unicorn/filename-case': "off",
      'unicorn/prevent-abbreviations': 'off',
      'unicorn/no-null': 'off',
      'import-x/order': [
        'error',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
            'object',
            'type',
          ],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
            caseInsensitive: true,
          },
        },
      ],
      'import-x/order': 'off',
      "react/jsx-no-literals": ["warn", { 
        "noStrings": true,
        "allowedStrings": [
          // Original & Punctuation
          "!", "?", "-", "/", ":", ",", "(", ")", "%", "&", 
          "@", "#", "$", "^", "*", "+", "=", "|", ".", "...",

          // Commonly used single-character literals
          "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
          
          // UI Dividers & Whitespace placeholders
          "\u00a0", " ", " | ", " • ", " » ", " « ", "—", "–",
          
          // Common Logic/Unit symbols
          "x", "px", "rem", "em", "ms", "s", "°"
        ],
        "ignoreProps": true 
      }],
      'jsx-a11y/click-events-have-key-events': 'off',
      'jsx-a11y/no-static-element-interactions': 'off',
      // 'no-restricted-syntax': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression > TSAsExpression > Identifier[name=/^(serverOutput|clientOutput|response|result|output|res)$/]",
          message: 'Do not use double-casts on backend payloads. Use generated types from src/_sockets/apiTypes.generated.ts and discriminated unions instead.',
        },
      ],
    },
  },
  {
    files: [
      'src/**/*api/**/*.ts', 
      'src/**/*Api/**/*.ts', 
      'src/**/*sync/**/*.ts',
      'src/**/*Sync/**/*.ts'
    ],
    rules: {
      // '@typescript-eslint/no-unused-vars': 'off',
    },
  }
)
//npx eslint src/**/*.tsx