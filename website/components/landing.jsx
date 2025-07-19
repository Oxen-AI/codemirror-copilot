import { Card } from "@/components/ui/card"

export function Landing({ children }) {
  return (
    (<section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
      <div className="container px-4 md:px-6">
      
              {children}
      </div>
    </section>)
  );
}
