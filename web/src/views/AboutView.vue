<template>
  <div class="about-page">
    <div class="page-header">
      <h1>{{ $t('about.title') }}</h1>
      <p class="subtitle">{{ $t('about.subtitle') }}</p>
    </div>

    <section class="field-block">
      <h2>{{ $t('about.whatTitle') }}</h2>
      <p class="muted" style="font-size: 14px; color: var(--text-md); line-height: 1.6;">{{ $t('about.whatBody') }}</p>
    </section>

    <section class="field-block">
      <h2>{{ $t('about.howTitle') }}</h2>
      <div class="how-steps">
        <div class="how-step">
          <span class="how-step-num">1</span>
          <div>
            <div class="how-step-title">{{ $t('about.step1Title') }}</div>
            <div class="how-step-desc">{{ $t('about.step1Desc') }}</div>
          </div>
        </div>
        <div class="how-step">
          <span class="how-step-num">2</span>
          <div>
            <div class="how-step-title">{{ $t('about.step2Title') }}</div>
            <div class="how-step-desc">{{ $t('about.step2Desc') }}</div>
          </div>
        </div>
        <div class="how-step">
          <span class="how-step-num">3</span>
          <div>
            <div class="how-step-title">{{ $t('about.step3Title') }}</div>
            <div class="how-step-desc">{{ $t('about.step3Desc') }}</div>
          </div>
        </div>
        <div class="how-step">
          <span class="how-step-num">4</span>
          <div>
            <div class="how-step-title">{{ $t('about.step4Title') }}</div>
            <div class="how-step-desc">{{ $t('about.step4Desc') }}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="field-block">
      <h2>{{ $t('about.whoTitle') }}</h2>
      <p class="muted" style="font-size: 14px; color: var(--text-md); line-height: 1.6;">{{ $t('about.whoBody') }}</p>
    </section>
  </div>
</template>
