import * as exec from "@actions/exec";

export async function commitAndPush(
  paths: string[],
  message: string,
  userName: string,
  userEmail: string
): Promise<void> {
  await exec.exec("git", [ "config", "user.name", userName ]);
  await exec.exec("git", [ "config", "user.email", userEmail ]);
  await exec.exec("git", [ "add", ...paths ]);

  const exitCode = await exec.exec("git", [ "diff", "--staged", "--quiet" ], { ignoreReturnCode: true });
  if (exitCode === 0) {
    console.log("No token changes detected, skipping commit.");
    return;
  }

  await exec.exec("git", [ "commit", "-m", message ]);

  let pushOutput = "";
  const pushExitCode = await exec.exec("git", [ "push" ], {
    ignoreReturnCode: true,
    listeners: {
      stderr: (data) => {
        pushOutput += data.toString();
      },
    },
  });

  if (pushExitCode !== 0) {
    if (pushOutput.includes("non-fast-forward") || pushOutput.includes("rejected")) {
      throw new Error(
        "git push failed with a non-fast-forward error. Add a `concurrency:` group to your workflow to prevent parallel runs on the same branch."
      );
    }
    throw new Error(`git push failed with exit code ${pushExitCode}:\n${pushOutput}`);
  }
}
