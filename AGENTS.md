
# Backend code

- Strongly type all data, do not use `any`
- Do NOT call the remote API. Read the sample responses and API documentation under `doc/` directory.
- Utilize the sample response files in unit testing the API client.

# Testing code changes

Whenever you make changes to the code, run the auto-formatter for typescript changes:

    npm run format

Verify that your changes work by running the following commands:

    npm run clean
    npm run lint
    npm run test

Check the IDE SonarQube extension problems and fix any code issues.

# Secrets

Do NOT read the the `.env` file! There are secrets which the user manages. You should not use these.
