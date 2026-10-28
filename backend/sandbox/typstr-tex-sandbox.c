/*
 * typstr-tex-sandbox: run one TeX (or document conversion) tool as the
 * unprivileged typstr-tex user.
 *
 * TeX engines, biber and make4ht can read any file the calling user can read
 * (\input{/proc/1/environ}, \verbatiminput, Lua io.open, biber data sources).
 * The backend runs them through this setuid-root helper, which switches to a
 * user that can only reach the compile directory it was given access to.
 *
 * Installed root:typstr-tex, mode 4750, so only members of typstr-tex (the
 * backend user) can run it. TEX_UID and TEX_GID are set at build time.
 *
 * Usage: typstr-tex-sandbox <program> [args...]
 */
#define _GNU_SOURCE
#include <grp.h>
#include <stdio.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <unistd.h>

#ifndef TEX_UID
#error "TEX_UID must be defined"
#endif
#ifndef TEX_GID
#error "TEX_GID must be defined"
#endif

static const char *const allowed_programs[] = {
  "pdflatex", "xelatex", "lualatex", "latex",
  "bibtex", "biber", "makeindex", "make4ht",
  /* optional site-installed Typst -> Word converter, see exporter.ts */
  "typstr-docx-converter",
  NULL,
};

static int is_allowed(const char *program) {
  for (const char *const *entry = allowed_programs; *entry; entry++) {
    if (strcmp(program, *entry) == 0) return 1;
  }
  return 0;
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

  gid_t groups[] = { TEX_GID };
  if (setgroups(1, groups) != 0 || setresgid(TEX_GID, TEX_GID, TEX_GID) != 0 || setresuid(TEX_UID, TEX_UID, TEX_UID) != 0) {
    perror("typstr-tex-sandbox: dropping privileges");
    return 70;
  }
  if (setuid(0) == 0 || getuid() != TEX_UID || geteuid() != TEX_UID) {
    fprintf(stderr, "typstr-tex-sandbox: privileges were not dropped\n");
    return 70;
  }
  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    perror("typstr-tex-sandbox: PR_SET_NO_NEW_PRIVS");
    return 70;
  }

  /* Outputs stay readable and removable by the backend through the group. */
  umask(007);
  execvp(program, argv + 1);
  perror("typstr-tex-sandbox: exec");
  return 127;
}
