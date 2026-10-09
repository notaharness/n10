import { createRequire } from 'node:module';
import type * as Koffi from 'koffi';

/**
 * The Windows Job Object that ends this process's descendants with it.
 *
 * The process that owns PTYs joins a job with
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` before it starts anything.
 * Children inherit membership (jobs nest since Windows 8), the handle
 * is not inheritable and only this process holds it, and the job
 * allows no breakaway. When this process exits for any reason the
 * kernel closes the handle and terminates every process still in the
 * job: ConPTY's console hosts, the shells in them and any detached or
 * GUI process they started. ConPTY's own close sends CTRL_CLOSE_EVENT
 * only to its attached clients; the job covers the rest.
 *
 * POSIX has no equivalent and needs none here: PTY teardown hangs up
 * the session's process group.
 */
export interface ProcessJob {
  /** Every process the job holds right now, this one included. */
  processIds(): number[];
}

const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
const JobObjectBasicProcessIdList = 3;
const JobObjectExtendedLimitInformation = 9;
/** Room for this many ids in one process-list query. */
const MAX_LISTED_PROCESSES = 4096;

let joined: ProcessJob | null = null;

/** Join this process's own kill-on-close job, once; `null` off Windows. */
export function joinKillOnCloseJob(): ProcessJob | null {
  if (process.platform !== 'win32') return null;
  joined ??= createJob();
  return joined;
}

function createJob(): ProcessJob {
  // Loaded only here: the binding is a Windows dependency of this one call.
  const koffi = createRequire(import.meta.url)('koffi') as typeof Koffi;
  const kernel32 = koffi.load('kernel32.dll');
  koffi.opaque('JOB');
  const basic = koffi.struct('JOBOBJECT_BASIC_LIMIT_INFORMATION', {
    PerProcessUserTimeLimit: 'int64',
    PerJobUserTimeLimit: 'int64',
    LimitFlags: 'uint32',
    MinimumWorkingSetSize: 'size_t',
    MaximumWorkingSetSize: 'size_t',
    ActiveProcessLimit: 'uint32',
    Affinity: 'uintptr_t',
    PriorityClass: 'uint32',
    SchedulingClass: 'uint32',
  });
  const io = koffi.struct('IO_COUNTERS', {
    ReadOperationCount: 'uint64',
    WriteOperationCount: 'uint64',
    OtherOperationCount: 'uint64',
    ReadTransferCount: 'uint64',
    WriteTransferCount: 'uint64',
    OtherTransferCount: 'uint64',
  });
  const extended = koffi.struct('JOBOBJECT_EXTENDED_LIMIT_INFORMATION', {
    BasicLimitInformation: basic,
    IoInfo: io,
    ProcessMemoryLimit: 'size_t',
    JobMemoryLimit: 'size_t',
    PeakProcessMemoryUsed: 'size_t',
    PeakJobMemoryUsed: 'size_t',
  });
  const CreateJobObjectW = kernel32.func(
    'JOB *__stdcall CreateJobObjectW(void *attributes, const char16_t *name)'
  );
  const SetInformationJobObject = kernel32.func(
    'int __stdcall SetInformationJobObject(JOB *job, int infoClass, _In_ JOBOBJECT_EXTENDED_LIMIT_INFORMATION *info, uint32_t size)'
  );
  const QueryInformationJobObject = kernel32.func(
    'int __stdcall QueryInformationJobObject(JOB *job, int infoClass, _Out_ uint8_t *info, uint32_t size, _Out_ uint32_t *returned)'
  );
  const GetCurrentProcess = kernel32.func(
    'void *__stdcall GetCurrentProcess()'
  );
  const AssignProcessToJobObject = kernel32.func(
    'int __stdcall AssignProcessToJobObject(JOB *job, void *process)'
  );
  const GetLastError = kernel32.func('uint32_t __stdcall GetLastError()');

  const fail = (call: string): never => {
    throw new Error(`${call} failed (Windows error ${GetLastError()})`);
  };

  // No security attributes: the handle is not inheritable.
  const job = CreateJobObjectW(null, null);
  if (!job) fail('CreateJobObjectW');
  const limits = {
    BasicLimitInformation: { LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE },
  };
  if (
    !SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformation,
      limits,
      koffi.sizeof(extended)
    )
  )
    fail('SetInformationJobObject');
  if (!AssignProcessToJobObject(job, GetCurrentProcess()))
    fail('AssignProcessToJobObject');

  return {
    processIds() {
      // JOBOBJECT_BASIC_PROCESS_ID_LIST: two DWORD counts, then
      // ULONG_PTR ids.
      const list = Buffer.alloc(8 + 8 * MAX_LISTED_PROCESSES);
      const returned = [0];
      if (
        !QueryInformationJobObject(
          job,
          JobObjectBasicProcessIdList,
          list,
          list.length,
          returned
        )
      )
        fail('QueryInformationJobObject');
      const listed = list.readUInt32LE(4);
      return Array.from({ length: listed }, (_, i) =>
        Number(list.readBigUInt64LE(8 + 8 * i))
      );
    },
  };
}
