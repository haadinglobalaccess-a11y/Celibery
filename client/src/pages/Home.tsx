import { ErrorState } from '../components/ui';
import { useI18n } from '../i18n/I18n';
import { useCached } from '../lib/hooks';
import { useSeo } from '../lib/useSeo';
import type { HomeData } from '../lib/types';
import { BrandStory, CampaignGallery, CategorySpotlights, CategoryUniverse, ClosingCampaign, Ecosystem, ExploreCollection, FlagshipCampaigns, WhyCelibery } from '../storefront/HomeSections';
import { TheatreStage } from '../storefront/motion';
import { Ambient, CinematicHero } from '../three-d';

function HomeSkeleton() {
  return (
    <>
      <section className="cine dark" aria-busy="true">
        <Ambient />
        <div className="container cine__inner">
          <div className="cine__copy">
            <div className="skeleton skeleton--dark" style={{ height: 14, width: 220 }} />
            <div className="skeleton skeleton--dark" style={{ height: 64, width: '90%', marginTop: 24 }} />
            <div className="skeleton skeleton--dark" style={{ height: 64, width: '70%', marginTop: 12 }} />
            <div className="skeleton skeleton--dark" style={{ height: 48, width: 300, marginTop: 32, borderRadius: 999 }} />
          </div>
        </div>
      </section>
      <div className="container cx-section">
        <div className="cx-rail__track" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="cx-rail__item">
              <div className="skeleton" style={{ aspectRatio: '4 / 5', borderRadius: 24 }} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Homepage — the approved cinematic Hero (unchanged, Admin-controlled) followed by the CELIBERY
 * editorial campaign architecture. Every section reads /api/home; nothing is hard-coded.
 */
export default function Home() {
  const { t } = useI18n();
  const { data, error } = useCached<HomeData>('/api/home');
  useSeo(t.home.heroTitle, t.home.heroSubtitle);

  if (error) return <ErrorState onRetry={() => window.location.reload()} />;
  if (!data) return <HomeSkeleton />;

  return (
    <div className="cx-home">
      {data.hero.enabled !== false ? <CinematicHero data={data} /> : null}

      {/* The motion theatre is scoped below the Hero, so the protected Hero DOM is never observed. */}
      <TheatreStage className="cx-stage">
      {/* 01 */}
      <CategoryUniverse data={data} />
      {/* 02 */}
      <FlagshipCampaigns data={data} />
      <CampaignGallery data={data} />
      {/* 03 */}
      <ExploreCollection data={data} />
      {/* 04 */}
      <CategorySpotlights data={data} />
      {/* 05 */}
      <Ecosystem data={data} />
      {/* 06 */}
      <WhyCelibery />
      {/* 07 */}
      <BrandStory data={data} />
      {/* 08 */}
      <ClosingCampaign data={data} />
      </TheatreStage>
    </div>
  );
}
