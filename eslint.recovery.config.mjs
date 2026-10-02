import parser from '@babel/eslint-parser';

// Scope this new lint gate to the recovery work. Do not rewrite legacy code to
// introduce project-wide style rules. Babel parses TS without requiring a
// downgrade from this repository's TypeScript 7 to typescript-eslint's range.
export default [{
  files: ['src/services/{directChatRouting,peerIntent,intentTiming}.ts', 'src/components/PeerIntentBanner.tsx', 'src/components/SetIntentSheet.tsx', 'src/components/{DiscoverView,RightNowView,Navbar}.tsx', 'public/service-worker.js', 'supabase/functions/send-push/*.ts', 'src/components/NotificationsModal.tsx', 'src/services/{notificationInbox,notificationRouting,pushService}.ts', 'vite.config.ts', 'src/App.tsx', 'src/components/ChatRoomView.tsx', 'src/services/{realtimeRecovery,chatSubscriptions,messageMerge,chatMessageProcessing,chatHistoryOwnership,chatTrace,messageAlerts,profilePhotoService,iceCredentials,webrtcService,supabaseService,conversationRooms}.ts'],
  languageOptions: {
    parser,
    parserOptions: {
      requireConfigFile: false,
      babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'], allowUndeclaredExports: true } },
    },
  },
  rules: {
    'constructor-super': 'error',
    'for-direction': 'error',
    'getter-return': 'error',
    'no-async-promise-executor': 'error',
    'no-constant-condition': 'error',
    'no-dupe-args': 'error',
    'no-dupe-else-if': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-fallthrough': 'error',
    'no-unreachable': 'error',
    'no-unsafe-finally': 'error',
    'no-unsafe-optional-chaining': 'error',
    'use-isnan': 'error',
    'valid-typeof': 'error',
  },
}];
