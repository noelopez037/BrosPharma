# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start development server
npx expo start

# Run on specific platform
npx expo run:ios
npx expo run:android
npx expo start --web

# Lint
npx expo lint
```

No test runner is configured.

## Architecture

**BrosPharma** is a pharmacy sales & inventory management app (Spanish-language UI) built with Expo for iOS, Android, and Web.

### Tech Stack

- **Expo ~54 / React Native 0.81 / React 19** — cross-platform foundation
- **Expo Router ~6** — file-based routing with Drawer + Tab navigators
- **Supabase** — backend (auth, PostgreSQL database); client at `lib/supabase.ts`
- **React Context API** — app-level state (no Redux/Zustand)
- **React Native Reanimated ~4 + Gesture Handler** — animations
- **XLSX + Expo Print + Expo File System** — report exports (CSV, XLSX, PDF)
- **Expo Notifications** — push notifications (guarded for web)

### Routing Structure

```
app/
  _layout.tsx              ← Root layout; wraps all providers
  login.tsx, reset-password.tsx
  (drawer)/                ← Main authenticated shell
    _layout.tsx            ← Drawer navigator with role-based menu items
    (tabs)/                ← Primary tab navigator
      index.tsx            ← Dashboard / KPIs
      ventas.tsx           ← Sales list
      inventario.tsx       ← Inventory list
    clientes.tsx, compras.tsx, cxc.tsx, kardex.tsx, ...
    reportes/index.tsx     ← Reporting module
  venta-detalle.tsx        ← Sale detail (modal stack)
  venta-nueva.tsx          ← New sale flow
  compra-detalle.tsx, compra-nueva.tsx
  cliente-detalle.tsx, cliente-form.tsx
  select-cliente.tsx, select-producto.tsx, select-proveedor.tsx  ← Selection modals
  producto-edit.tsx, producto-modal.tsx
```

### State Management

Three React Contexts defined in `lib/` and mounted in `app/_layout.tsx`:

| Context | File | Purpose |
|---|---|---|
| `ThemePrefProvider` | `lib/themeContext.tsx` | Light/dark mode, persisted via AsyncStorage |
| `VentaDraftProvider` | `lib/ventaDraft.tsx` | In-progress sale (client, line items, recipe URI, comments) |
| `CompraDraftProvider` | `lib/compraDraft.tsx` | In-progress purchase |

Components consume these contexts to share draft state across the sale/purchase creation flow.

### Key Patterns

- **Platform guards**: Expo Notifications and other native-only APIs are wrapped in `Platform.OS !== 'web'` checks.
- **Role-based UI**: The `FACTURACION` role controls which drawer menu items are visible; role is fetched from Supabase and stored in component state after login.
- **Reporting**: `lib/reporting/` contains generators for each report type; exports are triggered from `components/reporting/` and `app/(drawer)/reportes/`.
- **Path alias**: `@/*` maps to the project root (configured in `tsconfig.json`).
- **Environment**: Supabase credentials are in `.env` as `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### Components

- `components/ui/` — low-level primitives (buttons, modals, inputs)
- `components/producto/` — product search and display
- `components/ventas/` — sale detail panels and line-item components
- `components/reporting/` — report UI and export triggers
- `components/auth/` — login/auth components
