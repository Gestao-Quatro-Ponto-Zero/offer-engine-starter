import { useState } from "react";
import { useExceptions, useApproveException, useRejectException } from "@/hooks/useExceptions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { format } from "date-fns";

export default function Exceptions() {
  const { data: exceptions, isLoading, error } = useExceptions();
  const approveMutation = useApproveException();
  const rejectMutation = useRejectException();

  const handleApprove = async (id: string) => {
    try {
      await approveMutation.mutateAsync(id);
      toast({
        title: "Exception Approved",
        description: "The exception has been successfully approved.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to approve exception.",
        variant: "destructive",
      });
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectMutation.mutateAsync(id);
      toast({
        title: "Exception Rejected",
        description: "The exception has been successfully rejected.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to reject exception.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) return <div>Loading exceptions...</div>;
  if (error) return <div>Error loading exceptions: {error.message}</div>;

  return (
    <div className="container mx-auto py-10">
      <h1 className="text-3xl font-bold mb-6">Exceptions</h1>

      {exceptions && exceptions.length === 0 ? (
        <p>No exceptions found.</p>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Rule Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {exceptions?.map((exception) => (
                <TableRow key={exception.id}>
                  <TableCell className="font-medium">{exception.id}</TableCell>
                  <TableCell>{exception.ruleName}</TableCell>
                  <TableCell>{exception.client}</TableCell>
                  <TableCell>${exception.amount.toFixed(2)}</TableCell>
                  <TableCell>{format(new Date(exception.date), "PPP")}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        exception.status === "pending"
                          ? "default"
                          : exception.status === "approved"
                          ? "success"
                          : "destructive"
                      }
                    >
                      {exception.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {exception.status === "pending" && (
                      <>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="outline" className="mr-2">
                              Approve
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action will approve the exception for client{" "}
                                {exception.client} related to rule {exception.ruleName}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleApprove(exception.id)}>
                                Approve
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>

                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive">Reject</Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This action will reject the exception for client{" "}
                                {exception.client} related to rule {exception.ruleName}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleReject(exception.id)}>
                                Reject
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
