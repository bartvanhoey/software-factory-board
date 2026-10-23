using EmployeeManagement.Models;
using Microsoft.EntityFrameworkCore;
using System;

namespace EmployeeManagement.API.Models
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
        : base(options)
        {
        }

        public DbSet<Employee> Employees { get; set; }
        public DbSet<Department> Departments { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            var department1 = new Department { DepartmentId = 1, DepartmentName = "IT" };
            var department2 = new Department { DepartmentId = 2, DepartmentName = "HR" };
            var department3 = new Department { DepartmentId = 3, DepartmentName = "Payroll" };
            var department4 = new Department { DepartmentId = 4, DepartmentName = "Admin" };

            //Seed Departments Table
            modelBuilder.Entity<Department>().HasData(department1);
            modelBuilder.Entity<Department>().HasData(department2);
            modelBuilder.Entity<Department>().HasData(department3);
            modelBuilder.Entity<Department>().HasData(department4);



            // Seed Employee Table
            modelBuilder.Entity<Employee>(b =>
            {
                b.HasData(new Employee
                {
                    EmployeeId = 1,
                    FirstName = "John",
                    LastName = "Hastings",
                    Email = "David@pragimtech.com",
                    DateOfBirth = new DateTime(1980, 10, 5),
                    Gender = Gender.Male,
                    DepartmentId = 1,
                    PhotoPath = "images/john.png",
                    // Department = department1
                });
                // b.OwnsOne(e => e.Department).HasData(department1);
            });


            modelBuilder.Entity<Employee>().HasData(new Employee
            {
                EmployeeId = 2,
                FirstName = "Sam",
                LastName = "Galloway",
                Email = "Sam@pragimtech.com",
                DateOfBirth = new DateTime(1981, 12, 22),
                Gender = Gender.Male,
                DepartmentId = 2,
                PhotoPath = "images/sam.jpg"
            });

            modelBuilder.Entity<Employee>().HasData(new Employee
            {
                EmployeeId = 3,
                FirstName = "Mary",
                LastName = "Smith",
                Email = "mary@pragimtech.com",
                DateOfBirth = new DateTime(1979, 11, 11),
                Gender = Gender.Female,
                DepartmentId = 1,
                PhotoPath = "images/mary.png"
            });

            modelBuilder.Entity<Employee>().HasData(new Employee
            {
                EmployeeId = 4,
                FirstName = "Sara",
                LastName = "Longway",
                Email = "sara@pragimtech.com",
                DateOfBirth = new DateTime(1982, 9, 23),
                Gender = Gender.Female,
                DepartmentId = 3,
                PhotoPath = "images/sara.png"
            });
        }
    }
}
