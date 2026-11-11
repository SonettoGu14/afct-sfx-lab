import GameSfxGenerator from './components/GameSfxGenerator';
import { useI18n } from './i18n';

const MARK_ASSET_PATH = `${import.meta.env.BASE_URL}afct-mark.svg`;
const SOURCE_REPO_URL = 'https://github.com/mowangblog/game-sfx-generator-web';

function App() {
  const { language, setLanguage, t } = useI18n();

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

        <p className="masthead__lead">{t('hero.subtitle')}</p>
      </header>

      <main className="page__main">
        <GameSfxGenerator />
      </main>

      <footer className="colophon">
        <p className="colophon__credit">
          {t('footer.creditPrefix')}{' '}
          <a className="colophon__link" href={SOURCE_REPO_URL} target="_blank" rel="noreferrer">
            game-sfx-generator-web
          </a>{' '}
          · GPL-3.0 · {t('footer.creditSuffix')}
        </p>
        <p className="colophon__note">{t('footer.note')}</p>
      </footer>
    </div>
  );
}

export default App;
