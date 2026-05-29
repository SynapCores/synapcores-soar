import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@synapcores/app-framework';
import { Mail } from 'lucide-react';

export default function LoginVerifyPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-3">
            <div className="rounded-full bg-primary/10 p-3">
              <Mail className="h-7 w-7 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Check your email</CardTitle>
          <CardDescription>
            We sent you a sign-in link. Click it to continue. It expires in 10 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center text-xs text-muted-foreground">
          In dev, the link is printed to the server console.
        </CardContent>
      </Card>
    </div>
  );
}
