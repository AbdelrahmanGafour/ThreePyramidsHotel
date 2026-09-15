import { Footer } from "@/shared/components/layout/Footer";
import { Header } from "@/shared/components/layout/Header";

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
