import { useState } from 'react';
import GameSfxGenerator from './components/GameSfxGenerator';
import MusicWorkbench from './components/MusicWorkbench';
import { useI18n } from './i18n';

const MARK_ASSET_PATH = `${import.meta.env.BASE_URL}afct-mark.svg`;
const MODE_STORAGE_KEY = 'afct-sfx-lab:mode-v1';

type WorkbenchMode = 'sfx' | 'music';

function readStoredMode(): WorkbenchMode {
  try {
    return window.localStorage.getItem(MODE_STORAGE_KEY) === 'music' ? 'music' : 'sfx';
  } catch {
    return 'sfx';
  }
}

function App() {
  const { language, setLanguage, t } = useI18n();
  const [mode, setMode] = useState<WorkbenchMode>(readStoredMode);
  const [musicMounted, setMusicMounted] = useState(mode === 'music');

  const selectMode = (nextMode: WorkbenchMode): void => {
    setMode(nextMode);
    if (nextMode === 'music') setMusicMounted(true);
    try {
      window.localStorage.setItem(MODE_STORAGE_KEY, nextMode);
    } catch {
      // storage may be unavailable
    }
  };

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead__row">
          <div className="masthead__brand">
            <img className="masthead__mark" src={MARK_ASSET_PATH} alt="" width={34} height={34} />
            <div className="masthead__text">
              <h1 className="masthead__title">AFCT SFX Lab</h1>
              <p className="masthead__dept">{t('hero.department')}</p>
            </div>
          </div>

          <div className="masthead__actions">
            <div className="mode-switch" role="group" aria-label={t('mode.label')}>
              <button
                type="button"
                className={mode === 'sfx' ? 'mode-switch__btn is-active' : 'mode-switch__btn'}
                aria-pressed={mode === 'sfx'}
                onClick={() => selectMode('sfx')}
              >
                {t('mode.sfx')}
              </button>
              <button
                type="button"
                className={mode === 'music' ? 'mode-switch__btn is-active' : 'mode-switch__btn'}
                aria-pressed={mode === 'music'}
                onClick={() => selectMode('music')}
              >
                {t('mode.music')}
              </button>
            </div>

            <div className="lang-switch" role="group" aria-label={t('lang.label')}>
              <button
                type="button"
                className={language === 'en' ? 'lang-switch__btn is-active' : 'lang-switch__btn'}
                aria-pressed={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                EN
              </button>
              <button
                type="button"
                className={language === 'zh' ? 'lang-switch__btn is-active' : 'lang-switch__btn'}
                aria-pressed={language === 'zh'}
                onClick={() => setLanguage('zh')}
              >
                中文
              </button>
            </div>
          </div>
        </div>

        <p className="masthead__lead">{t('hero.subtitle')}</p>
      </header>

      <main className="page__main">
        <div hidden={mode !== 'sfx'}>
          <GameSfxGenerator active={mode === 'sfx'} />
        </div>
        {musicMounted && (
          <div hidden={mode !== 'music'}>
            <MusicWorkbench active={mode === 'music'} />
          </div>
        )}
      </main>

      <footer className="colophon">
        <p className="colophon__credit">GPL-3.0-only · {t('footer.creditSuffix')}</p>
        <p className="colophon__note">{t('footer.note')}</p>
      </footer>
    </div>
  );
}

export default App;
