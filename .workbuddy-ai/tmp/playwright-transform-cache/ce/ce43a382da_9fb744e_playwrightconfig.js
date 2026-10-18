// cbd1e0cb3574b02347ff601de83e6add7f04a5cb
import { defineConfig } from '@playwright/test';

/**
 * E2E runs against the production build, not the dev server, so the bundle and
 * asset paths are what users get. SwiftShader keeps it working on machines with
 * no GPU; the game is happy with the slower frame rate.
 *
 * shortcut: pinned to the system Chrome (channel: 'chrome') because Playwright's
 * own Chromium download is blocked on this machine. Drop the channel line once
 * `npx playwright install chromium` can reach the CDN.
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: {
      width: 1280,
      height: 720
    },
    channel: 'chrome',
    launchOptions: {
      args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
    }
  },
  webServer: {
    // Bind the preview to IPv4 explicitly: some Windows dev machines resolve
    // `localhost` to `::1`, so an unqualified preview binds IPv6-only and the
    // IPv4 url poll below never sees it come up.
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180000
  }
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJkZWZpbmVDb25maWciLCJ0ZXN0RGlyIiwidGltZW91dCIsImV4cGVjdCIsImZ1bGx5UGFyYWxsZWwiLCJ3b3JrZXJzIiwicmVwb3J0ZXIiLCJ1c2UiLCJiYXNlVVJMIiwidmlld3BvcnQiLCJ3aWR0aCIsImhlaWdodCIsImNoYW5uZWwiLCJsYXVuY2hPcHRpb25zIiwiYXJncyIsIndlYlNlcnZlciIsImNvbW1hbmQiLCJ1cmwiLCJyZXVzZUV4aXN0aW5nU2VydmVyIiwicHJvY2VzcyIsImVudiIsIkNJIl0sInNvdXJjZXMiOlsicGxheXdyaWdodC5jb25maWcudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAnQHBsYXl3cmlnaHQvdGVzdCc7XG5cbi8qKlxuICogRTJFIHJ1bnMgYWdhaW5zdCB0aGUgcHJvZHVjdGlvbiBidWlsZCwgbm90IHRoZSBkZXYgc2VydmVyLCBzbyB0aGUgYnVuZGxlIGFuZFxuICogYXNzZXQgcGF0aHMgYXJlIHdoYXQgdXNlcnMgZ2V0LiBTd2lmdFNoYWRlciBrZWVwcyBpdCB3b3JraW5nIG9uIG1hY2hpbmVzIHdpdGhcbiAqIG5vIEdQVTsgdGhlIGdhbWUgaXMgaGFwcHkgd2l0aCB0aGUgc2xvd2VyIGZyYW1lIHJhdGUuXG4gKlxuICogc2hvcnRjdXQ6IHBpbm5lZCB0byB0aGUgc3lzdGVtIENocm9tZSAoY2hhbm5lbDogJ2Nocm9tZScpIGJlY2F1c2UgUGxheXdyaWdodCdzXG4gKiBvd24gQ2hyb21pdW0gZG93bmxvYWQgaXMgYmxvY2tlZCBvbiB0aGlzIG1hY2hpbmUuIERyb3AgdGhlIGNoYW5uZWwgbGluZSBvbmNlXG4gKiBgbnB4IHBsYXl3cmlnaHQgaW5zdGFsbCBjaHJvbWl1bWAgY2FuIHJlYWNoIHRoZSBDRE4uXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHRlc3REaXI6ICd0ZXN0cy9lMmUnLFxuICB0aW1lb3V0OiA2MF8wMDAsXG4gIGV4cGVjdDogeyB0aW1lb3V0OiAxMF8wMDAgfSxcbiAgZnVsbHlQYXJhbGxlbDogZmFsc2UsXG4gIHdvcmtlcnM6IDEsXG4gIHJlcG9ydGVyOiBbWydsaXN0J11dLFxuICB1c2U6IHtcbiAgICBiYXNlVVJMOiAnaHR0cDovLzEyNy4wLjAuMTo0MTczJyxcbiAgICB2aWV3cG9ydDogeyB3aWR0aDogMTI4MCwgaGVpZ2h0OiA3MjAgfSxcbiAgICBjaGFubmVsOiAnY2hyb21lJyxcbiAgICBsYXVuY2hPcHRpb25zOiB7XG4gICAgICBhcmdzOiBbJy0tdXNlLWdsPXN3aWZ0c2hhZGVyJywgJy0tZW5hYmxlLXVuc2FmZS1zd2lmdHNoYWRlcicsICctLW11dGUtYXVkaW8nXSxcbiAgICB9LFxuICB9LFxuICB3ZWJTZXJ2ZXI6IHtcbiAgICAvLyBCaW5kIHRoZSBwcmV2aWV3IHRvIElQdjQgZXhwbGljaXRseTogc29tZSBXaW5kb3dzIGRldiBtYWNoaW5lcyByZXNvbHZlXG4gICAgLy8gYGxvY2FsaG9zdGAgdG8gYDo6MWAsIHNvIGFuIHVucXVhbGlmaWVkIHByZXZpZXcgYmluZHMgSVB2Ni1vbmx5IGFuZCB0aGVcbiAgICAvLyBJUHY0IHVybCBwb2xsIGJlbG93IG5ldmVyIHNlZXMgaXQgY29tZSB1cC5cbiAgICBjb21tYW5kOiAnbnBtIHJ1biBidWlsZCAmJiBucG0gcnVuIHByZXZpZXcgLS0gLS1ob3N0IDEyNy4wLjAuMSAtLXBvcnQgNDE3MyAtLXN0cmljdFBvcnQnLFxuICAgIHVybDogJ2h0dHA6Ly8xMjcuMC4wLjE6NDE3MycsXG4gICAgcmV1c2VFeGlzdGluZ1NlcnZlcjogIXByb2Nlc3MuZW52LkNJLFxuICAgIHRpbWVvdXQ6IDE4MF8wMDAsXG4gIH0sXG59KTtcbiJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBU0EsWUFBWSxRQUFRLGtCQUFrQjs7QUFFL0M7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsZUFBZUEsWUFBWSxDQUFDO0VBQzFCQyxPQUFPLEVBQUUsV0FBVztFQUNwQkMsT0FBTyxFQUFFLEtBQU07RUFDZkMsTUFBTSxFQUFFO0lBQUVELE9BQU8sRUFBRTtFQUFPLENBQUM7RUFDM0JFLGFBQWEsRUFBRSxLQUFLO0VBQ3BCQyxPQUFPLEVBQUUsQ0FBQztFQUNWQyxRQUFRLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0VBQ3BCQyxHQUFHLEVBQUU7SUFDSEMsT0FBTyxFQUFFLHVCQUF1QjtJQUNoQ0MsUUFBUSxFQUFFO01BQUVDLEtBQUssRUFBRSxJQUFJO01BQUVDLE1BQU0sRUFBRTtJQUFJLENBQUM7SUFDdENDLE9BQU8sRUFBRSxRQUFRO0lBQ2pCQyxhQUFhLEVBQUU7TUFDYkMsSUFBSSxFQUFFLENBQUMsc0JBQXNCLEVBQUUsNkJBQTZCLEVBQUUsY0FBYztJQUM5RTtFQUNGLENBQUM7RUFDREMsU0FBUyxFQUFFO0lBQ1Q7SUFDQTtJQUNBO0lBQ0FDLE9BQU8sRUFBRSwrRUFBK0U7SUFDeEZDLEdBQUcsRUFBRSx1QkFBdUI7SUFDNUJDLG1CQUFtQixFQUFFLENBQUNDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQyxFQUFFO0lBQ3BDbkIsT0FBTyxFQUFFO0VBQ1g7QUFDRixDQUFDLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=