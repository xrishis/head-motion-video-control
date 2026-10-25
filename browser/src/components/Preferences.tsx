export type Sensitivity = 'relaxed' | 'balanced' | 'sensitive';
export interface PreferencesValue { pauseDelay: number; returnDelay: number; autoResume: boolean; sensitivity: Sensitivity }

export default function Preferences({ value, onChange }: { value: PreferencesValue; onChange: (value: PreferencesValue) => void }) {
  return <section className="preferences" aria-labelledby="preferences-heading">
    <h3 id="preferences-heading">Playback preferences</h3>
    <div className="preference-field">
      <label htmlFor="pause-delay">Pause after looking away <span>{value.pauseDelay} {value.pauseDelay === 1 ? 'second' : 'seconds'}</span></label>
      <input id="pause-delay" type="range" min={1} max={5} step={.5} value={value.pauseDelay} onChange={event => onChange({ ...value, pauseDelay: Number(event.target.value) })} />
    </div>
    <div className="preference-field">
      <div className="switch-row"><label htmlFor="auto-resume">Resume automatically</label><button id="auto-resume" role="switch" aria-label="Resume automatically" aria-checked={value.autoResume} className={`switch ${value.autoResume ? 'checked' : ''}`} onClick={() => onChange({ ...value, autoResume: !value.autoResume })}><span /></button></div>
      <p className="field-help">Only resumes a lesson paused by the assistant.</p>
    </div>
    <div className="preference-field">
      <label htmlFor="return-delay">Return delay <span>{value.returnDelay} {value.returnDelay === 1 ? 'second' : 'seconds'}</span></label>
      <input id="return-delay" type="range" min={.5} max={3} step={.5} value={value.returnDelay} onChange={event => onChange({ ...value, returnDelay: Number(event.target.value) })} />
    </div>
    <div className="select-row"><label htmlFor="sensitivity">Sensitivity</label><select id="sensitivity" value={value.sensitivity} onChange={event => onChange({ ...value, sensitivity: event.target.value as Sensitivity })}><option value="relaxed">Relaxed</option><option value="balanced">Balanced</option><option value="sensitive">Sensitive</option></select></div>
  </section>;
}
