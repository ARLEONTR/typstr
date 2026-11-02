/*
 * typstr-tex-sandbox: run one TeX (or document conversion) tool as the
 * unprivileged typstr-tex user.
 *
 * TeX engines, biber and make4ht can read any file the calling user can read
 * (\input{/proc/1/environ}, \verbatiminput, Lua io.open, biber data sources).
 * The backend runs them through this setuid-root helper, which switches to a
 * user that can only reach the compile directory it was given access to.
 *
 * The backend cannot signal a process of another user, so the helper stays
 * as the tool's parent: it forwards termination signals to the tool, and if
 * the helper itself is killed (compile timeout) the tool gets SIGKILL through
 * its parent-death signal. Otherwise a document that loops forever would keep
 * its process running after the compile gave up. A CPU time limit backs this.
 *
 * Installed root:typstr-tex, mode 4750, so only members of typstr-tex (the
 * backend user) can run it. TEX_UID and TEX_GID are set at build time.
 *
 * Usage: typstr-tex-sandbox <program> [args...]
 */
#define _GNU_SOURCE
#include <errno.h>
#include <grp.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef TEX_UID
#error "TEX_UID must be defined"
#endif
#ifndef TEX_GID
#error "TEX_GID must be defined"
#endif
#ifndef TEX_CPU_SECONDS
#define TEX_CPU_SECONDS 300
#endif

static const char *const allowed_programs[] = {
  "pdflatex", "xelatex", "lualatex", "latex",
  "bibtex", "biber", "makeindex", "make4ht",
  /* optional site-installed Typst -> Word converter, see exporter.ts */
  "typstr-docx-converter",
  NULL,
};

static const int forwarded_signals[] = { SIGTERM, SIGINT, SIGHUP, SIGQUIT };

static volatile sig_atomic_t tool_pid = 0;

static int is_allowed(const char *program) {
  for (const char *const *entry = allowed_programs; *entry; entry++) {
    if (strcmp(program, *entry) == 0) return 1;
  }
  return 0;
}

static void forward_signal(int sig) {
  if (tool_pid > 0) kill((pid_t)tool_pid, sig);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: %s <program> [args...]\n", argv[0]);
    return 64;
  }

  const char *program = argv[1];
  if (strchr(program, '/') || !is_allowed(program)) {
    fprintf(stderr, "typstr-tex-sandbox: %s is not an allowed program\n", program);
    return 64;
  }

  struct rlimit cpu = { TEX_CPU_SECONDS, TEX_CPU_SECONDS + 10 };
  if (setrlimit(RLIMIT_CPU, &cpu) != 0) {
    perror("typstr-tex-sandbox: RLIMIT_CPU");
    return 70;
  }

  gid_t groups[] = { TEX_GID };
  if (setgroups(1, groups) != 0 || setresgid(TEX_GID, TEX_GID, TEX_GID) != 0) {
    perror("typstr-tex-sandbox: dropping group privileges");
    return 70;
  }

  /* Signals that arrive before the tool's pid is known are held until then. */
  sigset_t forwarded, previous;
  sigemptyset(&forwarded);
  for (size_t i = 0; i < sizeof forwarded_signals / sizeof *forwarded_signals; i++) {
    sigaddset(&forwarded, forwarded_signals[i]);
  }
  sigprocmask(SIG_BLOCK, &forwarded, &previous);

  uid_t caller = getuid();
  pid_t helper = getpid();
  pid_t pid = fork();
  if (pid < 0) {
    perror("typstr-tex-sandbox: fork");
    return 70;
  }

  if (pid == 0) {
    if (setresuid(TEX_UID, TEX_UID, TEX_UID) != 0) {
      perror("typstr-tex-sandbox: dropping privileges");
      _exit(70);
    }
    if (setuid(0) == 0 || getuid() != TEX_UID || geteuid() != TEX_UID) {
      fprintf(stderr, "typstr-tex-sandbox: privileges were not dropped\n");
      _exit(70);
    }
    /* Set after the uid change, which clears it; survives the exec. */
    if (prctl(PR_SET_PDEATHSIG, SIGKILL, 0, 0, 0) != 0 || getppid() != helper) {
      _exit(70);
    }
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
      perror("typstr-tex-sandbox: PR_SET_NO_NEW_PRIVS");
      _exit(70);
    }
    sigprocmask(SIG_SETMASK, &previous, NULL);

    /* Outputs stay readable and removable by the backend through the group. */
    umask(007);
    execvp(program, argv + 1);
    perror("typstr-tex-sandbox: exec");
    _exit(127);
  }

  /* The helper keeps the caller as real uid, so the backend can still signal
     it, and the TeX user as effective and saved uid, to signal the tool; it
     holds no root privileges while it waits. */
  uid_t real = caller == 0 ? TEX_UID : caller;
  if (setresuid(real, TEX_UID, TEX_UID) != 0 || setuid(0) == 0 || geteuid() != TEX_UID) {
    kill(pid, SIGKILL);
    fprintf(stderr, "typstr-tex-sandbox: privileges were not dropped\n");
    return 70;
  }

  tool_pid = pid;
  struct sigaction action;
  memset(&action, 0, sizeof action);
  action.sa_handler = forward_signal;
  sigemptyset(&action.sa_mask);
  for (size_t i = 0; i < sizeof forwarded_signals / sizeof *forwarded_signals; i++) {
    sigaction(forwarded_signals[i], &action, NULL);
  }
  sigprocmask(SIG_SETMASK, &previous, NULL);

  int status;
  while (waitpid(pid, &status, 0) < 0) {
    if (errno != EINTR) {
      perror("typstr-tex-sandbox: waitpid");
      return 70;
    }
  }
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return WIFEXITED(status) ? WEXITSTATUS(status) : 70;
}
