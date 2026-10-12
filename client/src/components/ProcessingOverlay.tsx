import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cancelTask } from '../app/actions'
import { formatBytes, formatDuration, formatMegapixels } from '../lib/format'
import { useAppStore, type Task, type TaskStage } from '../store/useAppStore'
import './ProcessingOverlay.css'

type StepState = 'pending' | 'active' | 'done'

interface Step {
  key: string
  label: string
  state: StepState
  /** 0–100 for a determinate bar, null for an indeterminate one. */
  percent: number | null
  detail?: string
  aside?: string
  weight: number
}

const ORDER: TaskStage[] = ['upload', 'verify', 'queued', 'analyzing', 'tiling', 'thumbnail', 'finalizing']

function stepState(stage: TaskStage, from: TaskStage, to: TaskStage): StepState {
  const current = ORDER.indexOf(stage)
  if (current > ORDER.indexOf(to)) return 'done'
  return current >= ORDER.indexOf(from) ? 'active' : 'pending'
}

function buildSteps(task: Task): Step[] {
  const { stage, job, upload } = task
  const steps: Step[] = []

  if (task.hasUpload) {
    const state = stepState(stage, 'upload', 'upload')
    steps.push({
      key: 'upload',
      label: 'Upload',
      state,
      percent: upload ? (upload.loaded / Math.max(upload.total, 1)) * 100 : 0,
      aside: upload ? `${formatBytes(upload.loaded)} / ${formatBytes(upload.total)}` : undefined,
      detail:
        state === 'active' && upload && upload.bytesPerSecond > 0
          ? `${formatBytes(upload.bytesPerSecond)}/s · ${formatDuration(upload.etaMs)} left`
          : undefined,
      weight: 25,
    })
  }

  const analyzeState = stepState(stage, 'verify', 'analyzing')
  steps.push({
    key: 'analyze',
    label: 'Analyze image',
    state: analyzeState,
    percent: null,
    detail:
      analyzeState !== 'active'
        ? undefined
        : stage === 'verify'
          ? 'Hashing and checking the format…'
          : stage === 'queued'
            ? 'Waiting for the tiler…'
            : job?.message,
    weight: 5,
  })

  const tilingState = stepState(stage, 'tiling', 'tiling')
  steps.push({
    key: 'tiling',
    label: 'Generate tiles',
    state: tilingState,
    percent: tilingState === 'active' ? (job?.percent ?? 0) : tilingState === 'done' ? 100 : 0,
    aside: tilingState === 'active' ? `${Math.round(job?.percent ?? 0)} %` : undefined,
    detail:
      tilingState === 'active' && job
        ? `${job.message}${job.etaMs != null ? ` · ${formatDuration(job.etaMs)} left` : ''}`
        : undefined,
    weight: 65,
  })

  const finalState = stepState(stage, 'thumbnail', 'finalizing')
  steps.push({
    key: 'finalize',
    label: 'Preview & cache',
    state: finalState,
    percent: null,
    detail: finalState === 'active' ? job?.message : undefined,
    weight: 5,
  })

  return steps
}

function overallPercent(steps: Step[]): number {
  const total = steps.reduce((sum, s) => sum + s.weight, 0)
  const done = steps.reduce((sum, step) => {
    if (step.state === 'done') return sum + step.weight
    if (step.state === 'active') return sum + (step.weight * (step.percent ?? 30)) / 100
    return sum
  }, 0)
  return Math.min(100, (done / total) * 100)
}

function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])
  return <span className="mono">{formatDuration(now - since)}</span>
}

function ProgressRing({ percent }: { percent: number }) {
  const radius = 30
  const circumference = 2 * Math.PI * radius
  return (
    <div className="ring">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <defs>
          <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle className="ring__track" cx="36" cy="36" r={radius} />
        <circle
          className="ring__value"
          cx="36"
          cy="36"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - percent / 100)}
        />
      </svg>
      <span className="ring__label mono">{Math.floor(percent)}%</span>
    </div>
  )
}

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') {
    return (
      <span className="step__icon is-done">
        <Check size={13} strokeWidth={3} />
      </span>
    )
  }
  if (state === 'active') {
    return (
      <span className="step__icon is-active">
        <LoaderCircle size={16} className="spinner" />
      </span>
    )
  }
  return <span className="step__icon" />
}

export function ProcessingOverlay() {
  const task = useAppStore((s) => s.task)
  if (!task) return null

  const steps = buildSteps(task)
  const percent = overallPercent(steps)
  const title = task.stage === 'upload' ? 'Uploading image' : task.hasUpload ? 'Preparing image' : 'Regenerating tiles'

  return (
    <div className="processing" role="dialog" aria-modal="true" aria-labelledby="processing-title">
      {task.previewUrl ? (
        <img className="processing__preview" src={task.previewUrl} alt="" aria-hidden="true" />
      ) : (
        <div className="processing__preview processing__preview--fallback" aria-hidden="true" />
      )}
      <div className="processing__scrim" />

      <div className="processing__card card">
        <div className="processing__head">
          <ProgressRing percent={percent} />
          <div className="processing__heading">
            <span id="processing-title" className="processing__title">
              {title}
            </span>
            <span className="processing__file" title={task.fileName}>
              {task.fileName}
            </span>
            <span className="processing__meta">
              {[
                task.fileSize != null ? formatBytes(task.fileSize) : null,
                task.width && task.height
                  ? `${task.width.toLocaleString()} × ${task.height.toLocaleString()} px · ${formatMegapixels(task.width, task.height)}`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        </div>

        <ol className="steps">
          {steps.map((step) => (
            <li key={step.key} className={`step is-${step.state}`}>
              <StepIcon state={step.state} />
              <div className="step__body">
                <div className="step__row">
                  <span className="step__label">{step.label}</span>
                  {step.aside && <span className="step__aside mono">{step.aside}</span>}
                </div>
                {step.state === 'active' && (
                  <div className={`bar${step.percent == null ? ' bar--indeterminate' : ''}`}>
                    <div className="bar__fill progress-fill" style={{ width: step.percent == null ? undefined : `${step.percent}%` }} />
                  </div>
                )}
                {step.detail && <span className="step__detail">{step.detail}</span>}
              </div>
            </li>
          ))}
        </ol>

        <div className="processing__foot">
          <span className="processing__elapsed">
            Elapsed <ElapsedTime since={task.startedAt} />
          </span>
          <button type="button" className="btn btn--small" onClick={() => cancelTask()}>
            Cancel <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  )
}
