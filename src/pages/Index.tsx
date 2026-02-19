import React, { useEffect, useState } from 'react';
import HeroSection from '@/components/HeroSection';
import RevenueSection from '@/components/RevenueSection';
import HowItWorks from '@/components/HowItWorks';
import UseCases from '@/components/UseCases';
import TestimonialsSection from '@/components/TestimonialsSection';
import MissedCallCalculator from '@/components/ROICalculator';
import PricingSection from '@/components/PricingSection';
import FAQSection from '@/components/FAQSection';
import { useLocation } from 'react-router-dom';
import CalendarDialog from '@/components/CalendarDialog';
import Widget from '@/components/Widget';
import { SEO, getOrganizationSchema, getFAQSchema } from '@/lib/seo';

const Index = () => {
  const location = useLocation();
  const [calendarOpen, setCalendarOpen] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
    if (location.hash) {
      setTimeout(() => {
        const element = document.getElementById(location.hash.slice(1));
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
        }
      }, 500);
    }
  }, [location.pathname, location.hash]);

  const faqs = [
    {
      question: 'What is SummitVoiceAI?',
      answer: 'SummitVoiceAI is an advanced AI voice assistant solution specifically designed for service businesses that helps capture every call, qualify leads, and book appointments 24/7 without human intervention.',
    },
    {
      question: 'How much can my business save with SummitVoiceAI?',
      answer: 'Most businesses save 60–80% compared to traditional receptionist costs. Our clients typically see ROI within the first month and savings of $30,000–$50,000 annually.',
    },
    {
      question: 'Does SummitVoiceAI integrate with my existing systems?',
      answer: 'Yes, SummitVoiceAI seamlessly integrates with most popular CRM systems, scheduling software, and business management tools including Salesforce, Google Calendar, Microsoft Outlook, and industry-specific platforms.',
    },
    {
      question: 'How accurate is the voice recognition?',
      answer: 'Our AI voice technology achieves over 95% accuracy in understanding caller requests, questions, and information across various accents and background noise conditions.',
    },
  ];

  return (
    <>
      <SEO
        title="SummitVoiceAI - #1 Voice AI for Service Businesses | Best Voice AI Company in United States"
        description="Transform your service business with SummitVoiceAI's cutting-edge voice AI technology. The best voice AI receptionist automation for service-based businesses. Never miss calls, automate scheduling, qualify leads 24/7. Number one voice AI company in United States."
        keywords={[
          'voice AI', 'voice AI service-based business', 'best voice AI for businesses',
          'voice AI receptionist', 'voice AI automation', 'number one voice AI company in United States',
          'AI voice assistant', 'virtual receptionist', 'voice AI for business', 'AI call answering',
          'automated scheduling', '24/7 call handling', 'lead qualification AI', 'phone automation',
          'business voice assistant', 'AI receptionist', 'voice AI technology', 'automated phone system',
          'AI phone answering service', 'voice automation software', 'intelligent voice assistant',
          'conversational AI', 'voice AI solutions', 'AI customer service', 'voice recognition AI',
          'smart phone assistant', 'voice AI platform', 'business phone AI', 'automated call handling',
          'voice AI integration', 'AI powered receptionist', 'voice AI for service companies',
          'professional voice AI', 'enterprise voice AI', 'voice AI software', 'AI voice technology',
          'automated appointment booking', 'voice AI scheduling', 'AI call management',
          'voice AI lead capture', 'intelligent call routing', 'voice AI analytics', 'AI phone support',
          'voice AI customer service', 'automated voice response', 'voice AI CRM integration',
          'AI telephone assistant', 'voice AI for small business', 'commercial voice AI', 'voice AI ROI',
        ]}
        schema={[getOrganizationSchema(), getFAQSchema(faqs)]}
      />

      <div style={{ background: '#000000', minHeight: '100vh', overflowX: 'hidden' }}>
        <HeroSection calendarOpen={calendarOpen} setCalendarOpen={setCalendarOpen} />

        {/* Widget kept right after hero */}
        <Widget />

        <RevenueSection />
        <HowItWorks />
        <UseCases />
        <TestimonialsSection />
        <MissedCallCalculator />
        <PricingSection onOpenCalendar={() => setCalendarOpen(true)} />
        <FAQSection />

        <CalendarDialog open={calendarOpen} setOpen={setCalendarOpen} />
      </div>
    </>
  );
};

export default Index;
