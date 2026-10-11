import { useNavigate } from 'react-router-dom'
import { BookOpen, FileWarning, Bot, ShieldCheck, Users, ArrowRight } from 'lucide-react'

const features = [
  {
    icon: FileWarning,
    title: '43 Warning Letter Analyses',
    description:
      'Deep-dive breakdowns of FDA warning letters — what went wrong, why it matters, and how to prevent the same findings in your organization.',
  },
  {
    icon: BookOpen,
    title: 'Curated Bookstore',
    description:
      'A hand-picked library of quality and regulatory books selected by industry veterans. Every title has been vetted for practical, real-world value.',
  },
  {
    icon: Bot,
    title: 'AI Learning Tool',
    description:
      'An AI assistant trained on regulatory documents, FDA guidance, and case study material — ask questions, explore scenarios, and learn by doing.',
  },
  {
    icon: Users,
    title: 'Case Studies & Blog',
    description:
      'Written material and case studies curated to help quality professionals build the judgment that textbooks alone can\'t teach.',
  },
]

export default function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-white">
      {/* Nav */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-6 h-6 text-indigo-600" />
          <span className="font-semibold text-gray-900 text-lg">AcceleraQA</span>
        </div>
        <button
          onClick={() => navigate('/auth')}
          className="px-4 py-2 rounded-lg text-sm font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 transition-colors"
        >
          Sign in
        </button>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-16 text-center">
        <span className="inline-block text-xs font-semibold tracking-widest text-indigo-500 uppercase mb-4">
          Quality &amp; Regulatory Learning
        </span>
        <h1 className="text-4xl font-bold text-gray-900 leading-tight mb-5">
          Training the Next Generation<br />of Quality Leaders
        </h1>
        <p className="text-lg text-gray-500 max-w-xl mx-auto mb-8">
          AcceleraQA is a learning company built for pharmaceutical quality and regulatory
          professionals. We curate the resources, case studies, and tools that help you build
          real-world regulatory judgment — not just checkbox knowledge.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => navigate('/auth')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors"
          >
            Get started <ArrowRight className="w-4 h-4" />
          </button>
          <a
            href="https://acceleraqa.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            Learn more
          </a>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div className="grid sm:grid-cols-2 gap-6">
          {features.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="rounded-2xl border border-gray-100 bg-gray-50 p-6 hover:border-indigo-100 hover:bg-indigo-50/30 transition-colors"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-indigo-600" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
              <p className="text-sm text-gray-500 leading-relaxed">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-indigo-600 py-14 px-6 text-center">
        <h2 className="text-2xl font-bold text-white mb-3">
          Ready to accelerate your regulatory career?
        </h2>
        <p className="text-indigo-200 mb-6 max-w-md mx-auto text-sm">
          Join quality professionals who are building real expertise through curated resources and AI-powered learning.
        </p>
        <button
          onClick={() => navigate('/auth')}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-indigo-600 bg-white hover:bg-indigo-50 transition-colors"
        >
          Create an account <ArrowRight className="w-4 h-4" />
        </button>
      </section>

      <footer className="text-center py-6 text-xs text-gray-400">
        © {new Date().getFullYear()} AcceleraQA. All rights reserved.
      </footer>
    </div>
  )
}
