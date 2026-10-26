# Google sign-up and login

Both account screens provide a Google option:

- **Create account → Sign up with Google** creates the first personal owner, profile, integration settings, and a session. A password is not required.
- **Sign in → Sign in with Google** signs in the existing owner. Unknown accounts are directed to sign up; a second account cannot claim an occupied instance.
- Signing up again with the existing Google identity signs in without creating duplicate records.
- A verified Gmail or Google Workspace identity can link to an existing password account with the same email. A Google identity already linked to a different subject is rejected. Third-party email accounts require password login instead of automatic linking.
- Google identity is keyed by its stable subject ID. Profile and application records stay attached to the same account.

Google authentication uses identity scopes only: openid, email, and profile. Reading or sending Gmail messages requires a separate authorization from Settings after signing in.

## Enable it

1. Open the [Google Cloud console](https://console.cloud.google.com/) and select or create a project.
2. Configure the Google Auth Platform consent screen and audience for your personal app. If using a testing audience, add your Google account as a test user.
3. Create an OAuth client with application type **Web application**.
4. Add this exact authorized redirect URI:

   http://127.0.0.1:3000/api/google/callback

5. Add your credentials to the ignored **backend/.env** file:

```dotenv
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/api/google/callback
OWNER_EMAIL=your-address@gmail.com
```

6. Ensure TOKEN_ENCRYPTION_KEY is set to a persistent 64-character hexadecimal key. The existing `npm run setup` command creates this key for a new environment. Keep it private; changing it invalidates pending Google flows and existing encrypted Gmail credentials.
7. Restart the backend. The Google buttons become available automatically. Complete real Google authentication in a regular Chrome or Edge browser; Google may reject embedded browser authentication.

Use http://127.0.0.1:3000 consistently. Switching to localhost changes cookie/origin behavior and requires matching configuration and a registered redirect URI.

No Google secrets belong in frontend environment variables or source control. Add credentials directly to backend/.env instead of posting them in chat.

## Gmail is optional

To connect Gmail later, enable the Gmail API in the same Cloud project. Settings → Connect Gmail requests read and send scopes with offline access. Both permissions must be granted for this app’s Gmail workflow. Google’s testing and verification requirements apply independently to those additional scopes.

## Validation

OAuth regression tests use an injected provider client; they never exchange real credentials with Google. Tests cover first signup, returning login, identity linking, owner restrictions, duplicate prevention, state/nonce validation, expiration, cancellation, provider failures, and separate Gmail consent.

A complete live sign-in requires real credentials and the matching Cloud redirect configuration. None are included in the project.

References: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Google server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).
