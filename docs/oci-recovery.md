# OCI ownership and interrupted controllers

Mill records an intent before starting each verifier or dependency-preparation
container. Each intent has a unique name, repository namespace, and private
ownership nonce. The container receives matching labels. Recovery checks those
labels, removes the observed container ID, and checks that ID is absent before
discarding the intent. It never removes a container just because its name starts
with `mill-`.

A kernel-owned SQLite lease prevents another Mill process from taking over an
active OCI operation. The lease file sits beside the repository state directory;
purge cannot unlink it while a controller holds it. An abrupt process exit
releases the lease, but does not stop a Docker daemon's containers.

## Recover an interrupted operation

Keep the original state directory and Docker daemon available. Retrying baseline
qualification, verification, dependency preparation, start, resume, or review
first reconciles earlier OCI intents. Cancellation also attempts recovery before
recording a terminal result. State restore and attended purge reconcile before
changing state or deleting worktrees; their underlying state APIs reject active
or unresolved OCI ownership.

- `OCI_CONTROLLER_ACTIVE`: another controller holds the lease. Let it finish or
  cancel it through its normal command. Do not delete the lease file.
- `OCI_RESOURCE_OWNERSHIP_MISMATCH`: the inspected resource does not match the
  saved ownership labels. Mill leaves it alone and preserves its intent.
- `OCI_RECONCILIATION_REQUIRED`: Mill could not establish removal. Restore the
  original daemon connection and retry. Keep the state, candidate worktrees, and
  preparation directories until the resource's fate is established.

An intent whose launch was never attempted can be cleared automatically. Once a
launch was attempted, an absent container can mean a lost or delayed daemon
request. Mill conservatively blocks unless it previously recorded the exact
container ID. Before removal, it persists that ID and the daemon identity;
recovery can then confirm absence on the same daemon even if the removal
response was lost. Never-observed launches need operator investigation; there is
no automatic override that deletes the journal. Do not share journal files or
raw Docker inspection output: they contain the private ownership nonce.

Greenfield apply preserves its staging directory, target lock, and state if OCI
cleanup is uncertain. It does not publish a successful repository or erase the
only ownership record. Interrupted greenfield staging is not an automatically
resumable product repository; investigate the retained state before disposing of
the staging directory and lock.

The pnpm and packed-release qualification scripts also retain failed fixtures
instead of deleting their parent directories. Their failure output identifies
the private paths for recovery. Investigate any live containers or pending
intents before removing those paths; successful qualification still cleans up.

## Deadline boundary

Command deadlines and cancellation require a live Mill controller. If the
controller and Docker client both die, a daemon-owned container can continue
beyond that deadline until recovery removes it. Mill does not provide a
host-independent watchdog. This matters especially for dependency preparation,
which has network access; verifier commands retain their network and mount
restrictions even if their controller exits.

These controls do not make a hostile local operator or compromised Docker daemon
safe. The host, private Mill state, and Docker daemon remain trusted.
