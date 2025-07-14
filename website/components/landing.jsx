import { Card } from "@/components/ui/card"

export function Landing({ children }) {
  return (
    (<section className="w-full py-12 md:py-24 lg:py-32 xl:py-48">
      <div className="container px-4 md:px-6">
        
          <Card>
            <div className="p-4">
              <h3 className="font-bold mb-3">Fast, Local, Tab Complete</h3>
              {children}
            </div>
          </Card>
      </div>
    </section>)
  );
}
