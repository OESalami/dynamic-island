/* eslint-disable react-refresh/only-export-components -- Vendored from the
   ElevenLabs UI registry as a single file, and the registry's public API is its
   hooks alongside the component. Splitting them would break `components add`
   upgrades. The rule only affects Fast Refresh granularity, which does not apply
   to a component this app never edits at runtime. */

/**
 * Bar Visualizer — real-time audio frequency visualizer.
 *
 * Source: the ElevenLabs UI registry, `components/ui/bar-visualizer.tsx`
 * (https://ui.elevenlabs.io/docs/components/bar-visualizer), converted from
 * TypeScript to the JSX this project uses. Behaviour is unchanged; only the type
 * annotations were dropped, the `@/lib/utils` import made relative, the Web Audio
 * teardown made exception-safe, and two React patterns corrected:
 *
 *   - `setState` on the "no stream" path became a derived value, so losing a
 *     stream no longer costs an extra render pass.
 *   - the band/option dependency lists name primitives rather than the objects
 *     they came from, so an inline literal cannot re-create an analyser.
 *
 * The bars are driven by real frequency data from a `MediaStream` — the agent's
 * own audio while it speaks and the microphone while the user does — so the same
 * component covers both halves of a conversation. With no stream the bars sit at
 * their minimum height and the per-state highlight carries the meaning.
 *
 * Analyser options matter here and are not the library defaults:
 *   fftSize 512               resolves the band edges finely enough to fill
 *                              every bar on speech input
 *   minDecibels -85           the island is small and the mic sits far away
 *   maxDecibels -20           a speech peak must not peg every bar at maxHeight
 */

import { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '../../lib/utils.js'

const AudioContextCtor =
  typeof window !== 'undefined'
    ? window.AudioContext || window.webkitAudioContext
    : undefined

/**
 * Build an analyser fed by `mediaStream`.
 *
 * One `AudioContext` per analyser, torn down with it, so an unmounted visualizer
 * never leaves a running context behind. `resume()` is called because the island
 * window is `focusable: false` and never receives a user gesture, so Chromium can
 * hand back a context that is created but suspended.
 */
function createAudioAnalyser(mediaStream, options = {}) {
  if (!AudioContextCtor) {
    throw new Error('Web Audio is unavailable in this environment.')
  }

  const audioContext = new AudioContextCtor()
  const source = audioContext.createMediaStreamSource(mediaStream)
  const analyser = audioContext.createAnalyser()

  if (options.fftSize) analyser.fftSize = options.fftSize
  if (options.smoothingTimeConstant !== undefined) {
    analyser.smoothingTimeConstant = options.smoothingTimeConstant
  }
  if (options.minDecibels !== undefined) analyser.minDecibels = options.minDecibels
  if (options.maxDecibels !== undefined) analyser.maxDecibels = options.maxDecibels

  source.connect(analyser)

  if (audioContext.state === 'suspended') {
    void audioContext.resume().catch(() => {
      // A context that stays suspended reports silence. The state-driven
      // highlight still runs, so there is nothing to recover here.
    })
  }

  const cleanup = () => {
    try {
      source.disconnect()
    } catch {
      // Already disconnected by the teardown.
    }
    void audioContext.close().catch(() => {
      // Already closed.
    })
  }

  return { analyser, audioContext, cleanup }
}

/**
 * Volume of an audio stream, 0..1.
 *
 * @param {MediaStream | null | undefined} mediaStream
 * @param {{fftSize?: number, smoothingTimeConstant?: number, minDecibels?: number, maxDecibels?: number}} [options]
 * @returns {number}
 */
export function useAudioVolume(
  mediaStream,
  { fftSize = 32, smoothingTimeConstant = 0, minDecibels, maxDecibels } = {}
) {
  const [volume, setVolume] = useState(0)
  const volumeRef = useRef(0)
  const frameId = useRef(undefined)

  const options = useMemo(
    () => ({ fftSize, smoothingTimeConstant, minDecibels, maxDecibels }),
    [fftSize, smoothingTimeConstant, minDecibels, maxDecibels]
  )

  useEffect(() => {
    // A stream is required; with none there is nothing to report, and the derived
    // return below reads as silence.
    if (!mediaStream) {
      volumeRef.current = 0
      return
    }

    const { analyser, cleanup } = createAudioAnalyser(mediaStream, options)

    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    let lastUpdate = 0
    const updateInterval = 1000 / 30 // 30 FPS

    const updateVolume = (timestamp) => {
      if (timestamp - lastUpdate >= updateInterval) {
        analyser.getByteFrequencyData(dataArray)
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const a = dataArray[i]
          sum += a * a
        }
        const newVolume = Math.sqrt(sum / dataArray.length) / 255

        // Only update state if volume changed significantly
        if (Math.abs(newVolume - volumeRef.current) > 0.01) {
          volumeRef.current = newVolume
          setVolume(newVolume)
        }
        lastUpdate = timestamp
      }
      frameId.current = requestAnimationFrame(updateVolume)
    }

    frameId.current = requestAnimationFrame(updateVolume)

    return () => {
      cleanup()
      if (frameId.current) cancelAnimationFrame(frameId.current)
    }
  }, [mediaStream, options])

  return mediaStream ? volume : 0
}

const multibandDefaults = {
  bands: 5,
  loPass: 100,
  hiPass: 600,
  updateInterval: 32,
  analyserOptions: { fftSize: 2048 },
}

/** Map a dB reading onto 0..1, clamped to a range that speech actually occupies. */
const normalizeDb = (value) => {
  if (value === -Infinity) return 0
  const minDb = -100
  const maxDb = -10
  const db = 1 - (Math.max(minDb, Math.min(maxDb, value)) * -1) / 100
  return Math.sqrt(db)
}

/**
 * Volume across a range of frequency bands, for the bar heights.
 *
 * `loPass` and `hiPass` are bin indices, not frequencies in Hz: bin *i* of an
 * FFT covers roughly *i* × `sampleRate / fftSize`. The registry's 100–200 range
 * is therefore bins 100–200, which at a 2048-point FFT is far above anything a
 * voice produces, so every bar would have read zero. The island passes a wide
 * low-index range instead — see the `BarVisualizer` call below.
 *
 * @param {MediaStream | null | undefined} mediaStream
 * @param {{bands?: number, loPass?: number, hiPass?: number, updateInterval?: number, analyserOptions?: object}} [options]
 * @returns {number[]}
 */
export function useMultibandVolume(
  mediaStream,
  {
    bands = multibandDefaults.bands,
    loPass = multibandDefaults.loPass,
    hiPass = multibandDefaults.hiPass,
    updateInterval = multibandDefaults.updateInterval,
    analyserOptions = multibandDefaults.analyserOptions,
  } = {}
) {
  const {
    fftSize = multibandDefaults.analyserOptions.fftSize,
    smoothingTimeConstant,
    minDecibels,
    maxDecibels,
  } = analyserOptions

  const opts = useMemo(
    () => ({
      bands,
      loPass,
      hiPass,
      updateInterval,
      analyserOptions: { fftSize, smoothingTimeConstant, minDecibels, maxDecibels },
    }),
    [bands, loPass, hiPass, updateInterval, fftSize, smoothingTimeConstant, minDecibels, maxDecibels]
  )

  const [frequencyBands, setFrequencyBands] = useState(() => new Array(bands).fill(0))
  const bandsRef = useRef(new Array(bands).fill(0))
  const frameId = useRef(undefined)

  const silent = useMemo(() => new Array(bands).fill(0), [bands])

  useEffect(() => {
    // No stream, nothing to analyse. `silent` below covers the return value.
    if (!mediaStream) {
      bandsRef.current = silent
      return
    }

    const { analyser, cleanup } = createAudioAnalyser(mediaStream, opts.analyserOptions)

    const dataArray = new Float32Array(analyser.frequencyBinCount)
    const sliceStart = opts.loPass
    const sliceEnd = opts.hiPass
    const sliceLength = sliceEnd - sliceStart

    let lastUpdate = 0
    const updateInterval = opts.updateInterval

    const updateVolume = (timestamp) => {
      if (timestamp - lastUpdate >= updateInterval) {
        analyser.getFloatFrequencyData(dataArray)

        const chunks = new Array(opts.bands)

        for (let i = 0; i < opts.bands; i++) {
          let sum = 0
          let count = 0
          // Band edges are partitioned exactly rather than as a fixed-width chunk.
          // A `ceil` chunk does not divide the range evenly, so with 15 bars over
          // 96 bins it overshot and the last bar ended up with an empty range —
          // `start > end`, so that bar always read zero.
          const startIdx = sliceStart + Math.floor((i * sliceLength) / opts.bands)
          const endIdx = sliceStart + Math.floor(((i + 1) * sliceLength) / opts.bands)

          for (let j = startIdx; j < endIdx; j++) {
            sum += normalizeDb(dataArray[j])
            count++
          }

          chunks[i] = count > 0 ? sum / count : 0
        }

        let hasChanged = false
        for (let i = 0; i < chunks.length; i++) {
          if (Math.abs(chunks[i] - bandsRef.current[i]) > 0.01) {
            hasChanged = true
            break
          }
        }

        if (hasChanged) {
          bandsRef.current = chunks
          setFrequencyBands(chunks)
        }

        lastUpdate = timestamp
      }

      frameId.current = requestAnimationFrame(updateVolume)
    }

    frameId.current = requestAnimationFrame(updateVolume)

    return () => {
      cleanup()
      if (frameId.current) cancelAnimationFrame(frameId.current)
    }
  }, [mediaStream, opts, silent])

  return mediaStream ? frequencyBands : silent
}

/**
 * Indices of the bars that should be highlighted in the current state.
 *
 * @param {'connecting' | 'initializing' | 'listening' | 'speaking' | 'thinking' | undefined} state
 * @param {number} columns
 * @param {number} interval ms between frames
 * @returns {number[]}
 */
export const useBarAnimator = (state, columns, interval) => {
  const indexRef = useRef(0)
  const [currentFrame, setCurrentFrame] = useState([])
  const animationFrameId = useRef(null)

  const sequence = useMemo(() => {
    if (state === 'thinking' || state === 'listening') {
      return generateListeningSequenceBar(columns)
    }
    if (state === 'connecting' || state === 'initializing') {
      return generateConnectingSequenceBar(columns)
    }
    if (state === undefined || state === 'speaking') {
      return [new Array(columns).fill(0).map((_, idx) => idx)]
    }
    return [[]]
  }, [state, columns])

  // A new state means a new sequence, so the animation restarts at its first
  // frame. Adjusting during render is React's supported alternative to an effect
  // whose only job is to reset state, and it avoids the extra render pass.
  const [previousSequence, setPreviousSequence] = useState(sequence)
  if (previousSequence !== sequence) {
    setPreviousSequence(sequence)
    setCurrentFrame(sequence[0] || [])
  }

  useEffect(() => {
    indexRef.current = 0
    let startTime = performance.now()

    const animate = (time) => {
      const timeElapsed = time - startTime

      if (timeElapsed >= interval) {
        indexRef.current = (indexRef.current + 1) % sequence.length
        setCurrentFrame(sequence[indexRef.current] || [])
        startTime = time
      }

      animationFrameId.current = requestAnimationFrame(animate)
    }

    animationFrameId.current = requestAnimationFrame(animate)

    return () => {
      if (animationFrameId.current !== null) {
        cancelAnimationFrame(animationFrameId.current)
      }
    }
  }, [interval, sequence])

  return currentFrame
}

/** A highlight that walks in from both ends, for `connecting` / `initializing`. */
const generateConnectingSequenceBar = (columns) => {
  const seq = []
  for (let x = 0; x < columns; x++) {
    seq.push([x, columns - 1 - x])
  }
  return seq
}

/** A single centre highlight, blinking for `thinking` / `listening`. */
const generateListeningSequenceBar = (columns) => {
  const center = Math.floor(columns / 2)
  const noIndex = -1
  return [[center], [noIndex]]
}

const BarVisualizerComponent = forwardRef(function BarVisualizer(
  {
    state,
    barCount = 15,
    mediaStream,
    minHeight = 20,
    maxHeight = 100,
    demo = false,
    centerAlign = false,
    className,
    style,
    ...props
  },
  ref
) {
  // Bins 1..97 of a 512-point FFT. At 48 kHz that is roughly 94 Hz to 9 kHz, which
  // is the band a voice actually occupies; the registry's defaults measure bands
  // the voice never reaches, which is why every bar sat at minimum height.
  // 96 bins across 15 bars divides evenly, so no bar is left without one.
  const realVolumeBands = useMultibandVolume(mediaStream, {
    bands: barCount,
    loPass: 1,
    hiPass: 1 + barCount * 6,
    analyserOptions: {
      fftSize: 512,
      minDecibels: -85,
      maxDecibels: -20,
    },
  })

  const fakeVolumeBandsRef = useRef(new Array(barCount).fill(0.2))
  const [fakeVolumeBands, setFakeVolumeBands] = useState(() => new Array(barCount).fill(0.2))
  const fakeAnimationRef = useRef(undefined)

  // Demo data is only meaningful while something is playing; the flat array is
  // derived rather than stored so switching states costs no render of its own.
  const isDemoActive = demo && (state === 'speaking' || state === 'listening')
  const restingDemoBands = useMemo(() => new Array(barCount).fill(0.2), [barCount])

  useEffect(() => {
    if (!isDemoActive) return

    let lastUpdate = 0
    const updateInterval = 50
    const startTime = Date.now() / 1000

    const updateFakeVolume = (timestamp) => {
      if (timestamp - lastUpdate >= updateInterval) {
        const time = Date.now() / 1000 - startTime
        const newBands = new Array(barCount)

        for (let i = 0; i < barCount; i++) {
          const waveOffset = i * 0.5
          const baseVolume = Math.sin(time * 2 + waveOffset) * 0.3 + 0.5
          const randomNoise = Math.random() * 0.2
          newBands[i] = Math.max(0.1, Math.min(1, baseVolume + randomNoise))
        }

        let hasChanged = false
        for (let i = 0; i < barCount; i++) {
          if (Math.abs(newBands[i] - fakeVolumeBandsRef.current[i]) > 0.05) {
            hasChanged = true
            break
          }
        }

        if (hasChanged) {
          fakeVolumeBandsRef.current = newBands
          setFakeVolumeBands(newBands)
        }

        lastUpdate = timestamp
      }

      fakeAnimationRef.current = requestAnimationFrame(updateFakeVolume)
    }

    fakeAnimationRef.current = requestAnimationFrame(updateFakeVolume)

    return () => {
      if (fakeAnimationRef.current) cancelAnimationFrame(fakeAnimationRef.current)
    }
  }, [isDemoActive, barCount])

  const volumeBands = useMemo(() => {
    if (!demo) return realVolumeBands
    return isDemoActive ? fakeVolumeBands : restingDemoBands
  }, [demo, isDemoActive, fakeVolumeBands, restingDemoBands, realVolumeBands])

  const highlightedIndices = useBarAnimator(
    state,
    barCount,
    state === 'connecting'
      ? 2000 / barCount
      : state === 'thinking'
        ? 150
        : state === 'listening'
          ? 500
          : 1000
  )

  return (
    <div
      ref={ref}
      data-state={state}
      className={cn(
        'relative flex justify-center gap-1.5',
        centerAlign ? 'items-center' : 'items-end',
        'bg-muted h-32 w-full overflow-hidden rounded-lg p-4',
        className
      )}
      style={{ ...style }}
      {...props}
    >
      {volumeBands.map((volume, index) => {
        const heightPct = Math.min(maxHeight, Math.max(minHeight, volume * 100 + 5))
        const isHighlighted = highlightedIndices?.includes(index) ?? false

        return (
          <Bar
            key={index}
            heightPct={heightPct}
            isHighlighted={isHighlighted}
            state={state}
          />
        )
      })}
    </div>
  )
})

const Bar = memo(function Bar({ heightPct, isHighlighted, state }) {
  return (
    <div
      data-highlighted={isHighlighted}
      className={cn(
        'max-w-[12px] min-w-[8px] flex-1 transition-all duration-150',
        'rounded-full',
        'bg-border data-[highlighted=true]:bg-primary',
        state === 'speaking' && 'bg-primary',
        state === 'thinking' && isHighlighted && 'animate-pulse'
      )}
      style={{
        height: `${heightPct}%`,
        animationDuration: state === 'thinking' ? '300ms' : undefined,
      }}
    />
  )
})

Bar.displayName = 'Bar'

const BarVisualizer = memo(BarVisualizerComponent, (prevProps, nextProps) => {
  return (
    prevProps.state === nextProps.state &&
    prevProps.barCount === nextProps.barCount &&
    prevProps.mediaStream === nextProps.mediaStream &&
    prevProps.minHeight === nextProps.minHeight &&
    prevProps.maxHeight === nextProps.maxHeight &&
    prevProps.demo === nextProps.demo &&
    prevProps.centerAlign === nextProps.centerAlign &&
    prevProps.className === nextProps.className &&
    JSON.stringify(prevProps.style) === JSON.stringify(nextProps.style)
  )
})

BarVisualizerComponent.displayName = 'BarVisualizerComponent'
BarVisualizer.displayName = 'BarVisualizer'

export { BarVisualizer }
