import GameSfxGenerator from './components/GameSfxGenerator';
import { useI18n } from './i18n';

const MARK_ASSET_PATH = `${import.meta.env.BASE_URL}afct-mark.svg`;
const SOURCE_REPO_URL = 'https://github.com/mowangblog/game-sfx-generator-web';

function App() {
  const { language, setLanguage, t } = useI18n();

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <main className="app-shell">
        <header className="hero">
          <div className="hero-top">
            <div className="hero-brand">
              <img className="hero-brand__mark" src={MARK_ASSET_PATH} alt="" />
              <div className="hero-brand__text">
                <p className="hero-brand__eyebrow">{t('hero.department')}</p>
                <h1 className="hero-brand__title">AFCT SFX Lab</h1>
                <p className="hero-brand__sub">{t('hero.subtitle')}</p>
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
        </header>

        <GameSfxGenerator />

        <footer className="app-footer">
          <p className="app-footer__credit">
            {t('footer.creditPrefix')}{' '}
            <a
              className="app-footer__credit-link"
              href={SOURCE_REPO_URL}
              target="_blank"
              rel="noreferrer"
            >
              game-sfx-generator-web
            </a>{' '}
            · GPL-3.0 · {t('footer.creditSuffix')}
          </p>
          <p className="app-footer__note">{t('footer.note')}</p>
        </footer>
      </main>
    </div>
  );
}

export default App;
